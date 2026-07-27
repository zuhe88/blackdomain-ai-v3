function readVarint(buffer, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < buffer.length && shift <= 63n) {
    const byte = buffer[offset];
    offset += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
  }
  throw new Error("Invalid DG protobuf varint.");
}

function integer(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function readFields(buffer) {
  const fields = [];
  let offset = 0;
  let count = 0;

  while (offset < buffer.length) {
    if (count >= 10000) throw new Error("DG protobuf field limit exceeded.");
    count += 1;
    const key = readVarint(buffer, offset);
    offset = key.offset;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (!field) throw new Error("Invalid DG protobuf field.");

    if (wire === 0) {
      const decoded = readVarint(buffer, offset);
      offset = decoded.offset;
      fields.push({ field, wire, value: decoded.value });
    } else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new Error("Truncated DG protobuf field.");
      fields.push({ field, wire, value: buffer.subarray(offset, offset + 8) });
      offset += 8;
    } else if (wire === 2) {
      const lengthValue = readVarint(buffer, offset);
      offset = lengthValue.offset;
      const length = Number(lengthValue.value);
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > buffer.length) {
        throw new Error("Invalid DG protobuf length.");
      }
      fields.push({ field, wire, value: buffer.subarray(offset, offset + length) });
      offset += length;
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new Error("Truncated DG protobuf field.");
      fields.push({ field, wire, value: buffer.subarray(offset, offset + 4) });
      offset += 4;
    } else {
      throw new Error(`Unsupported DG protobuf wire type: ${wire}`);
    }
  }

  return fields;
}

function text(value) {
  return Buffer.from(value).toString("utf8");
}

function decodeDealer(buffer) {
  const dealer = {};
  for (const item of readFields(buffer)) {
    if (item.field === 1 && item.wire === 0) dealer.id = integer(item.value);
    if (item.field === 2 && item.wire === 2) dealer.name = text(item.value);
    if (item.field === 3 && item.wire === 2) dealer.no = text(item.value);
    if (item.field === 4 && item.wire === 2) dealer.photo = text(item.value);
  }
  return dealer;
}

function decodeTable(buffer) {
  const table = { tel: [], ext: [], roads: [] };
  for (const item of readFields(buffer)) {
    if (item.field === 1 && item.wire === 0) table.tableId = integer(item.value);
    if (item.field === 2 && item.wire === 0) table.shoeId = integer(item.value);
    if (item.field === 3 && item.wire === 0) table.playId = integer(item.value);
    if (item.field === 4 && item.wire === 0) table.state = integer(item.value);
    if (item.field === 5 && item.wire === 0) table.countDown = integer(item.value);
    if (item.field === 6 && item.wire === 2) table.result = text(item.value);
    if (item.field === 7 && item.wire === 2) table.poker = text(item.value);
    if (item.field === 8 && item.wire === 2) table.tel.push(text(item.value));
    if (item.field === 9 && item.wire === 2) table.ext.push(text(item.value));
    if (item.field === 10 && item.wire === 2) table.roads.push(text(item.value));
    if (item.field === 11 && item.wire === 2) table.gameNo = text(item.value);
    if (item.field === 12 && item.wire === 2) table.fms = text(item.value);
    if (item.field === 13 && item.wire === 2) table.tableName = text(item.value);
    if (item.field === 14 && item.wire === 2) table.vipName = text(item.value);
    if (item.field === 15 && item.wire === 0) table.totalAmount = integer(item.value);
    if (item.field === 16 && item.wire === 0) table.onlineCount = integer(item.value);
    if (item.field === 17 && item.wire === 2) table.dealer = decodeDealer(item.value);
    if (item.field === 18 && item.wire === 0) table.gameId = integer(item.value);
  }
  return table;
}

function decodeLobbyPush(buffer) {
  const item = {};
  for (const field of readFields(buffer)) {
    if (field.field === 1 && field.wire === 0) item.tableId = integer(field.value);
    if (field.field === 2 && field.wire === 0) item.onlineCount = integer(field.value);
    if (field.field === 3 && field.wire === 0) item.totalAmount = integer(field.value);
    if (field.field === 4 && field.wire === 2) item.vipName = text(field.value);
    if (field.field === 5 && field.wire === 0) item.seatFull = field.value !== 0n;
  }
  return item;
}

function decodePublicBean(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 512 * 1024) {
    throw new Error("Invalid DG frame.");
  }

  const message = { list: [], lobbyPush: [], table: [] };
  for (const item of readFields(buffer)) {
    if (item.field === 1 && item.wire === 0) message.cmd = integer(item.value);
    if (item.field === 3 && item.wire === 0) message.codeId = integer(item.value);
    if (item.field === 4 && item.wire === 0) message.lobbyId = integer(item.value);
    if (item.field === 5 && item.wire === 2) message.gameNo = text(item.value);
    if (item.field === 6 && item.wire === 0) message.tableId = integer(item.value);
    if (item.field === 10 && item.wire === 0) message.type = integer(item.value);
    if (item.field === 12 && item.wire === 2) message.list.push(text(item.value));
    if (item.field === 14 && item.wire === 2) message.object = text(item.value);
    if (item.field === 16 && item.wire === 2) message.lobbyPush.push(decodeLobbyPush(item.value));
    if (item.field === 17 && item.wire === 2) message.table.push(decodeTable(item.value));
  }
  return message;
}

function decodeBase64Frame(value) {
  const raw = String(value || "");
  if (!raw || raw.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error("Invalid DG frame encoding.");
  }
  return decodePublicBean(Buffer.from(raw, "base64"));
}

module.exports = {
  decodeBase64Frame,
  decodePublicBean,
};
