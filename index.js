var inherits = require('util').inherits
  , EventEmitter = require('events').EventEmitter
  , Stream = require('stream').Stream
  , es = require('event-stream')
  , fs = require('fs')
  , path = require('path')
  , glob = require('glob')
  , debug = require('debug')('apacheconf')

function removeQuotes(str) {
  if ((str[0] == '"' && str[str.length - 1] == '"') || (str[0] == "'" && str[str.length - 1] == "'"))
    str = str.slice(1, str.length -1 )

  return str
}


module.exports = function(filename, options, cb) {
  if (arguments.length == 2) {
    cb = options
    options = {}
  }

  var stream = fs.createReadStream(filename)
    , parser = new Parser()

  parser.serverRoot = options.serverRoot || path.dirname(filename)

  parser.file = filename
  parser._stream = es.pause()
  parser.files = [ filename ]

  parser.name = 'global'

  parser._stream.on('end', function() {
    parser.end()
  })

  stream.on('error', function(err) {
    parser.emit('error', err)
  })

  if (cb) {
    parser.on('error', cb)
    parser.on('end', function() {
      cb(null, parser.config, parser)
    })
  }

  setupPipeline(stream, parser)

  return parser
}

function setupPipeline(stream, parser) {
  stream.pipe(es.split('\n')).pipe(parser._stream).pipe(parser, { end: false })
}


function ParseError(parser, message) {
  Error.call(this)
  Error.captureStackTrace(this)
  this.message = message
  this.parser = parser
  this.line = parser._getProp('lines')
  this.file = parser._getProp('file')
}
inherits(ParseError, Error)


function Parser() {
  Stream.call(this)
  this.writable = true
  this.lines = 0

  this._comments = []
  this.config = {}
}
inherits(Parser, Stream)


Parser.prototype.write = function(line) {
  this.lines++

  if (this._child) return this._child.write(line)

  if (this.multiline) {
    line = this.multiline + ' ' + line
    this.multiline = null
  }

  line = line.trim()

  if (!line) return true

  if (line[line.length - 1] === '\\' && line[line.length - 2] !== '\\') {
    this.multiline = line.slice(0, line.length - 1)
    return true
  }


  switch(line[0]) {
  case '<':
    if (line[1] == '/') {
      if (line.toLowerCase() != '</' + this.name.toLowerCase() + '>') {
        this.emit('error', new ParseError(this, 'Expecting ' + this.name + ' close tag, got ' + line))
        return true
      }

      debug('[block] /%s', this.name)
      this.emit('end')
      return true
    }


    var child = new Parser()
      , self = this
    this._child = child
    child._parent = this

    function onerror(err) {
      self.emit('error', err)
    }
    function onend() {
      self._child = null
      self.add(child.name, child.config)

      child.removeListener('end', onend)
      child.removeListener('error', onerror)
    }

    child.on('end', onend)
    child.on('error', onerror)


    line = line.slice(1, line.length - 1)

    child.name = line.split(/[ \t]/, 1)[0]
    child.config.$args = removeQuotes(line.slice(child.name.length + 1))

    debug('[block] %s', child.name)

    break

  case '#':
    debug('[comment] %s', line)
    this._comments.push(line)
    this.emit('comment', line)
    break

  default:
    var name = line.split(/[ \t]/, 1)[0]
      , value = line.slice(name.length + 1).trim()

    switch(name) {
    case 'Include':
    case 'IncludeOptional':
      var self = this
        , filepath = path.resolve(this._getProp('serverRoot'), value)

      this.pause()

      debug('[glob] %s', filepath)
      glob(filepath, function(err, files) {

        var current

        function next(err) {
          if (err) {
            if (err.code == 'EISDIR') {
              fs.readdir(current, function(err, _files) {
                if (err) return next(err)

                files = _files.map(function(file) {
                  return path.resolve(current, file)
                }).concat(files)

                next()
              })

            } else {
              self.emit('error', err)
            }

            return
          }

          if (!files.length) return self.resume()

          current = files.shift()
          self._include(current, next)
        }

        next(err)

      })

      debug('[add] %s: %s', name, value)
      this.add(name, value)

      break

    default:
      debug('[add] %s: %s', name, value)
      this.add(name, value)
      break
    }

    break
  }

  return true
}

Parser.prototype.end = function() {
  if (arguments.length) this.write.apply(this, arguments)
  this.emit('end')
}

Parser.prototype.add = function(name, value) {
  if (!this.config[name]) {
    this.config[name] = []
    this.config[name].comments = []
  }

  // Use the server root from config file
  if (name === 'ServerRoot') {
    this.serverRoot = removeQuotes(value)
  }

  this.config[name].push(value)
  this.config[name].comments.push(this._comments)

  this.emitValue(name, value)
  this._comments = []

}

Parser.prototype.emitValue = function (name, value) {
    this.emit('data', { name: name, value: value })
    this.emit(name, value)

    // Trigger event on parent
    if (this._parent) {
      this._parent.emitValue(name, value)
    }
}

Parser.prototype._getProp = function(prop) {
  var that = this
  while(!(prop in that) && that._parent) {
    that = that._parent
  }
  return that[prop]
}

Parser.prototype.pause = function() {
  debug('[stream] pause')
  return this._getProp('_stream').pause()
}

Parser.prototype.resume = function() {
  debug('[stream] resume')
  return this._getProp('_stream').resume()
}

Parser.prototype._include = function(filename, cb) {
  debug('[include] %s', filename)
  this._getProp('files').push(filename)

  var self = this
    , origStream = this._stream
    , origFile = this.file
    , origLines = this.lines
    , stream = fs.createReadStream(filename)

  self._stream = es.pause()
  self.file = filename
  self.lines = 0

  setupPipeline(stream, self)

  function cleanup(err) {
    self._stream = origStream
    self.file = origFile
    self.lines = origLines

    cb(err)
  }

  self._stream.on('end', cleanup)
  stream.on('error', cleanup)

}
