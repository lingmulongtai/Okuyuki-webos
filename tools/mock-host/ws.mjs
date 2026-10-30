// The server side of a WebSocket (RFC 6455), just enough for the event socket of the mock host:
// text frames, ping and close. Messages from the TV are small, so fragmented frames are not
// supported.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TEXT = 0x1;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;

class Peer extends EventEmitter {
	constructor(socket, head) {
		super();
		this.socket = socket;
		this.buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
		this.closed = false;
		socket.setNoDelay(true);
		socket.on('data', (data) => {
			this.buffer = Buffer.concat([this.buffer, data]);
			this.read();
		});
		socket.on('close', () => this.finish(1006));
		socket.on('error', () => this.finish(1006));
		if (this.buffer.length) setImmediate(() => this.read());
	}

	read() {
		while (!this.closed) {
			const b = this.buffer;
			if (b.length < 2) return;
			const opcode = b[0] & 0x0f;
			const masked = (b[1] & 0x80) !== 0;
			let length = b[1] & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (b.length < 4) return;
				length = b.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (b.length < 10) return;
				length = Number(b.readBigUInt64BE(2));
				offset = 10;
			}
			const mask = offset;
			if (masked) offset += 4;
			if (b.length < offset + length) return;
			const payload = Buffer.from(b.subarray(offset, offset + length));
			if (masked) {
				for (let i = 0; i < payload.length; i++) payload[i] ^= b[mask + (i % 4)];
			}
			this.buffer = b.subarray(offset + length);
			if (opcode === TEXT) {
				this.emit('message', payload.toString('utf8'));
			} else if (opcode === CLOSE) {
				this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000);
			} else if (opcode === PING) {
				this.frame(PONG, payload);
			}
		}
	}

	frame(opcode, payload) {
		if (this.closed || this.socket.destroyed) return;
		let header;
		if (payload.length < 126) {
			header = Buffer.from([0x80 | opcode, payload.length]);
		} else if (payload.length < 65536) {
			header = Buffer.alloc(4);
			header[0] = 0x80 | opcode;
			header[1] = 126;
			header.writeUInt16BE(payload.length, 2);
		} else {
			header = Buffer.alloc(10);
			header[0] = 0x80 | opcode;
			header[1] = 127;
			header.writeBigUInt64BE(BigInt(payload.length), 2);
		}
		this.socket.write(Buffer.concat([header, payload]));
	}

	send(text) {
		this.frame(TEXT, Buffer.from(text, 'utf8'));
	}

	close(code = 1000, reason = '') {
		if (this.closed) return;
		const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
		payload.writeUInt16BE(code, 0);
		payload.write(reason, 2);
		this.frame(CLOSE, payload);
		this.finish(code);
		this.socket.end();
	}

	finish(code) {
		if (this.closed) return;
		this.closed = true;
		this.emit('close', code);
	}
}

/** Completes the handshake for an HTTP upgrade request; returns the peer, or null if refused. */
export function accept(req, socket, head) {
	const key = req.headers['sec-websocket-key'];
	if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
		socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
		return null;
	}
	const digest = createHash('sha1').update(key + GUID).digest('base64');
	socket.write(
		'HTTP/1.1 101 Switching Protocols\r\n' +
		'Upgrade: websocket\r\n' +
		'Connection: Upgrade\r\n' +
		`Sec-WebSocket-Accept: ${digest}\r\n\r\n`
	);
	return new Peer(socket, head);
}
