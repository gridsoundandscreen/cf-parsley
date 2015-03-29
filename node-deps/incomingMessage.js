var Stream = require('stream');
var util = require('util');

function readStart(socket) {
    if (!socket || !socket._handle || !socket._handle.readStart || socket._paused)
        return;
    socket._handle.readStart();
}

/* Abstract base class for ServerRequest and ClientResponse. */
function IncomingMessage(socket) {
    Stream.Readable.call(this);

    // XXX This implementation is kind of all over the place
    // When the parser emits body chunks, they go in this list.
    // _read() pulls them out, and when it finds EOF, it ends.

    this.socket = socket;
    this.connection = socket;

    this.httpVersion = null;
    this.complete = false;
    this.headers = {};
    this.trailers = {};

    this.readable = true;

    this._pendings = [];
    this._pendingIndex = 0;

    // request (server) only
    this.url = '';
    this.method = null;

    // response (client) only
    this.statusCode = null;
    this.client = this.socket;

    // flag for backwards compatibility grossness.
    this._consuming = false;

    // flag for when we decide that this message cannot possibly be
    // read by the user, so there's no point continuing to handle it.
    this._dumped = false;
}
util.inherits(IncomingMessage, Stream.Readable);


IncomingMessage.prototype.setTimeout = function(msecs, callback) {
    if (callback)
        this.on('timeout', callback);
    this.socket.setTimeout(msecs);
};


IncomingMessage.prototype.read = function(n) {
    this._consuming = true;
    this.read = Stream.Readable.prototype.read;
    return this.read(n);
};


IncomingMessage.prototype._read = function(n) {
    // We actually do almost nothing here, because the parserOnBody
    // function fills up our internal buffer directly.  However, we
    // do need to unpause the underlying socket so that it flows.
    if (this.socket.readable)
        readStart(this.socket);
};


// It's possible that the socket will be destroyed, and removed from
// any messages, before ever calling this.  In that case, just skip
// it, since something else is destroying this connection anyway.
IncomingMessage.prototype.destroy = function(error) {
    if (this.socket)
        this.socket.destroy(error);
};


// Add the given (field, value) pair to the message
//
// Per RFC2616, section 4.2 it is acceptable to join multiple instances of the
// same header with a ', ' if the header in question supports specification of
// multiple values this way. If not, we declare the first instance the winner
// and drop the second. Extended header fields (those beginning with 'x-') are
// always joined.
IncomingMessage.prototype._addHeaderLine = function(field, value) {
    var dest = this.complete ? this.trailers : this.headers;

    field = field.toLowerCase();
    switch (field) {
        // Array headers:
        case 'set-cookie':
            if (dest[field] !== undefined) {
                dest[field].push(value);
            } else {
                dest[field] = [value];
            }
            break;

        // Comma separate. Maybe make these arrays?
        case 'accept':
        case 'accept-charset':
        case 'accept-encoding':
        case 'accept-language':
        case 'connection':
        case 'cookie':
        case 'pragma':
        case 'link':
        case 'www-authenticate':
        case 'proxy-authenticate':
        case 'sec-websocket-extensions':
        case 'sec-websocket-protocol':
            if (dest[field] !== undefined) {
                dest[field] += ', ' + value;
            } else {
                dest[field] = value;
            }
            break;


        default:
            if (field.slice(0, 2) == 'x-') {
                // except for x-
                if (dest[field] !== undefined) {
                    dest[field] += ', ' + value;
                } else {
                    dest[field] = value;
                }
            } else {
                // drop duplicates
                if (dest[field] === undefined) dest[field] = value;
            }
            break;
    }
};


// Call this instead of resume() if we want to just
// dump all the data to /dev/null
IncomingMessage.prototype._dump = function() {
    if (!this._dumped) {
        this._dumped = true;
        if (this.socket.parser) this.socket.parser.incoming = null;
        this.push(null);
        readStart(this.socket);
        this.read();
    }
};

module.exports = IncomingMessage;