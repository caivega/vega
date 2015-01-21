define(function(require, exports, module) {
  var encode  = require('./encode'),
      collect = require('../core/collector'),
      bounds  = require('./bounds'),
      group   = require('./group'),
      Item  = require('./Item'),
      parseData = require('../parse/data'),
      tuple = require('../core/tuple'),
      changeset = require('../core/changeset'),
      util = require('../util/index'),
      C = require('../util/constants');


  // def is from the spec
  // mark is the scenegraph node to build out
  // parent is the dataflow builder node corresponding to the mark's group.
  return function build(model, renderer, def, mark, parent, inheritFrom) {
    var items = [], // Item nodes in the scene graph
        f = (def.from ? def.from.data : null) || inheritFrom,
        from = util.isString(f) ? model.data(f) : null,
        map = {},
        lastBuild = 0,
        builder, encoder, bounder;

    function init() {
      mark.def = def;
      mark.marktype = def.type;
      mark.interactive = !(def.interactive === false);
      mark.items = items; 

      if(def.from && (def.from.transform || def.from.modify)) datasource();

      builder = new model.Node(buildItems);
      builder._type = 'builder';
      builder._router = true;
      builder._touchable = true;

      encoder = encode(model, mark);
      bounder = bounds(model, mark);
      builder.collector = collect(model);

      if(def.type === C.GROUP){ 
        builder.group = group(model, def, mark, builder, parent, renderer);
      }

      if(from) {
        builder._deps.data.push(f);
        encoder._deps.data.push(f);
      }

      connect();
      builder.disconnect = disconnect;      

      return builder;
    };

    // Mark-level transformations are handled here because they may be
    // inheriting from a group's faceted datasource. 
    function datasource() {
      var name = [f, def.type, Date.now()].join('_');
      var spec = {
        name: name,
        source: f,
        transform: def.from.transform,
        modify: def.from.modify
      };

      f = name;
      from = parseData.datasource(model, spec);

      // At this point, we have a new datasource but it is empty as
      // the propagation cycle has already crossed the datasources. 
      // So, we repulse just this datasource. This should be safe
      // as the ds isn't connected to the scenegraph yet.
      var input, output = from._source._output;
      input = from._input = changeset.create(output);
      input.add = output.add;
      input.mod = output.mod;
      input.rem = output.rem;
      input.stamp = null;
      from.fire();
    };

    function pipeline() {
      var pipeline = [builder, encoder];
      if(builder.group) pipeline.push(builder.group);
      pipeline.push(builder.collector, bounder, renderer);
      return pipeline;
    };

    function connect() {
      model.graph.connect(pipeline());
      encoder._deps.scales.forEach(function(s) {
        parent.group.scale(s).addListener(builder);
      });
      if(parent) bounder.addListener(parent.collector);
    };

    function disconnect() {
      model.graph.disconnect(pipeline());
      encoder._deps.scales.forEach(function(s) {
        parent.group.scale(s).removeListener(builder);
      });
      if(builder.group) builder.group.disconnect();
    };

    function newItem(d, stamp) {
      var item   = tuple.create(new Item(mark));
      item.datum = d;

      // For the root node's item
      if(def.width)  tuple.set(item, "width",  def.width, stamp);
      if(def.height) tuple.set(item, "height", def.height, stamp);

      return item;
    };

    function buildItems(input) {
      util.debug(input, ["building", f, def.type]);

      var fullUpdate = encoder.reevaluate(input),
          output, fcs, data;

      if(from) {
        output = changeset.create(input);

        // If a scale or signal in the update propset has been updated, 
        // send forward all items for reencoding if we do an early return.
        if(fullUpdate) output.mod = items.slice();

        fcs = from._output;
        if(!fcs) return output.touch = true, output;
        if(fcs.stamp <= lastBuild) return output;

        lastBuild = fcs.stamp;
        return joinChangeset(fcs);
      } else {
        data = util.isFunction(def.from) ? def.from() : [C.SENTINEL];
        return joinValues(input, data);
      }
    };

    function joinChangeset(input) {
      var keyf = keyFunction(def.key || "_id"),
          output = changeset.create(input),
          add = input.add, 
          mod = input.mod, 
          rem = input.rem,
          stamp = input.stamp,
          i, key, len, item, datum;

      for(i=0, len=add.length; i<len; ++i) {
        key = keyf(datum = add[i]);
        item = newItem(datum, stamp);
        tuple.set(item, "key", key, stamp);
        item.status = C.ENTER;
        map[key] = item;
        items.push(item);
        output.add.push(item);
      }

      for(i=0, len=mod.length; i<len; ++i) {
        item = map[key = keyf(datum = mod[i])];
        tuple.set(item, "key", key, stamp);
        item.datum  = datum;
        item.status = C.UPDATE;
        output.mod.push(item);
      }

      for(i=0, len=rem.length; i<len; ++i) {
        item = map[key = keyf(rem[i])];
        item.status = C.EXIT;
        output.rem.push(item);
        map[key] = null;
      }

      // Sort items according to how data is sorted, or by _id. The else 
      // condition is important to ensure lines and areas are drawn correctly.
      items.sort(function(a, b) { 
        return input.sort ? input.sort(a.datum, b.datum) : (a.datum._id - b.datum._id);
      });

      return output;
    }

    function joinValues(input, data) {
      var keyf = keyFunction(def.key),
          prev = items.splice(0),
          output = changeset.create(input),
          i, key, len, item, datum, enter;

      for (i=0, len=prev.length; i<len; ++i) {
        item = prev[i];
        item.status = C.EXIT;
        if (keyf) map[item.key] = item;
      }
      
      for (i=0, len=data.length; i<len; ++i) {
        datum = data[i];
        key = i;
        item = keyf ? map[key = keyf(datum)] : prev[i];
        if(!item) {
          items.push(item = newItem(datum, input.stamp));
          output.add.push(item);
          tuple.set(item, "key", key);
          item.status = C.ENTER;
        } else {
          items.push(item);
          output.mod.push(item);
          tuple.set(item, "key", key);
          item.datum = datum;
          item.status = C.UPDATE;
        }
      }

      for (i=0, len=prev.length; i<len; ++i) {
        item = prev[i];
        if (item.status === C.EXIT) {
          tuple.set(item, "key", keyf ? item.key : items.length);
          items.unshift(item);  // Keep item around for "exit" transition.
          output.rem.unshift(item);
        }
      }
      
      return output;
    };

    function keyFunction(key) {
      if (key == null) return null;
      var f = util.array(key).map(util.accessor);
      return function(d) {
        for (var s="", i=0, n=f.length; i<n; ++i) {
          if (i>0) s += "|";
          s += String(f[i](d));
        }
        return s;
      }
    };

    return init();
  }
})