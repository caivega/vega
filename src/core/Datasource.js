define(function(require, exports, module) {
  var changeset = require('./changeset'), 
      tuple = require('./tuple'), 
      collector = require('./collector'),
      util = require('../util/index'),
      C = require('../util/constants');

  return function(model) {
    function Datasource(name, facet) {
      this._name = name;
      this._data = [];
      this._source = null;
      this._facet = facet;
      this._input = changeset.create();
      this._output = null;    // Output changeset

      this._pipeline  = null; // Pipeline of transformations.
      this._collector = null; // Collector to materialize output of pipeline
    };

    Datasource.prototype.add = function(d) {
      var add = this._input.add;
      add.push.apply(add, util.array(d).map(function(d) { return tuple.create(d); }));
      return this;
    };

    Datasource.prototype.remove = function(where) {
      var d = this._data.filter(where);
      this._input.rem.push.apply(this._input.rem, d);
      return this;
    };

    Datasource.prototype.update = function(where, field, func) {
      var mod = this._input.mod;
      this._input.fields[field] = 1;
      this._data.filter(where).forEach(function(x) {
        var prev = x[field],
            next = func(x);
        if (prev !== next) {
          tuple.prev(x, field);
          x.__proto__[field] = next;
          if(mod.indexOf(x) < 0) mod.push(x);
        }
      });
      return this;
    };

    Datasource.prototype.values = function(data) {
      if(!arguments.length)
        return this._collector ? this._collector.data() : this._data;

      // Replace backing data
      this._input.rem = this._data.slice();
      if (data) { this.add(data); }
      return this;
    };

    Datasource.prototype.source = function(src) {
      if(!arguments.length) return this._source;
      this._source = model.data(src);
      return this;
    }

    Datasource.prototype.fire = function() {
      model.graph.propagate(this._input, this._pipeline[0]); 
    };

    Datasource.prototype.pipeline = function(pipeline) {
      var ds = this, n, c;

      if(pipeline.length) {
        // If we have a pipeline, add a collector to the end to materialize
        // the output.
        ds._collector = collector(model, pipeline);
        pipeline.push(ds._collector);
      }

      // Input node applies the datasource's delta, and propagates it to 
      // the rest of the pipeline. It receives touches to propagate data.
      var input = new model.Node(function(input) {
        util.debug(input, ["input", ds._name]);

        var delta = ds._input, 
            out = changeset.create(input);
        out.facet = ds._facet;

        if(input.touch) {
          out.mod = ds._source ? ds._source.values().slice() : ds._data.slice();
        } else {
          // update data
          var delta = ds._input;
          var ids = util.tuple_ids(delta.rem);

          ds._data = ds._data
            .filter(function(x) { return ids[x._id] !== 1; })
            .concat(delta.add);

          // reset change list
          ds._input = changeset.create();

          out.add = delta.add; 
          out.rem = delta.rem;

          // Assign a timestamp to any updated tuples
          out.mod = delta.mod.map(function(x) { 
            var k;
            if(x._prev === C.SENTINEL) return x;
            for(k in x._prev) {
              if(x._prev[k].stamp === undefined) x._prev[k].stamp = input.stamp;
            }
            return x;
          }); 
        }

        return out;
      });
      input._type = 'input';
      input._router = true;
      input._touchable = true;
      pipeline.unshift(input);
      model.addListener(input);

      // Output node puts this datasource's output data into the Model.db.
      // Downstream nodes will pull from there. This is important to prevent
      // glitches. 
      var output = new model.Node(function(input) {
        util.debug(input, ["output", ds._name]);

        ds._output = input;

        var out = changeset.create(input, true);
        out.data[ds._name] = 1;
        return out;
      });
      output._type = 'output';
      output._router = true;
      output._touchable = true;
      pipeline.push(output);

      ds._pipeline = pipeline;
      model.graph.connect(ds._pipeline);
      return this;
    };

    Datasource.prototype.addListener = function(l) {
      if(l instanceof Datasource) {
        var source = this, dest = l;
        l = new model.Node(function(input) {
          dest._input = source._output;
          return input;
        });
        l.addListener(dest._pipeline[0]);
      }

      this._pipeline[this._pipeline.length-1].addListener(l);
    };

    Datasource.prototype.removeListener = function(l) {
      this._pipeline[this._pipeline.length-1].removeListener(l);
    };

    return Datasource;
  }
});