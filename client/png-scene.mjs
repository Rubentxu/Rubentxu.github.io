const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_SCENE_KEYWORD = "application/vnd.excalidraw+json";
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const BYTE_STRING_CHUNK = 0x8000;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function byteString(bytes) {
    let result = "";
    for (let offset = 0; offset < bytes.length; offset += BYTE_STRING_CHUNK) {
        result += String.fromCharCode(...bytes.subarray(offset, offset + BYTE_STRING_CHUNK));
    }
    return result;
}

function chunkAt(bytes, offset) {
    if (offset + 12 > bytes.length) {
        throw new Error("malformed PNG chunk header");
    }
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const end = offset + 12 + length;
    if (end > bytes.length) {
        throw new Error("malformed PNG chunk length");
    }
    return { end, length, type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) };
}

function isPng(bytes) {
    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function sceneKeyword(data) {
    const separator = data.indexOf(0);
    return separator < 1 ? null : String.fromCharCode(...data.subarray(0, separator));
}

async function textChunk(scene) {
    const sceneBytes = TEXT_ENCODER.encode(scene);
    let compressed = null;
    if (typeof CompressionStream === "function") {
        try {
            const stream = new Blob([sceneBytes]).stream().pipeThrough(new CompressionStream("deflate"));
            compressed = new Uint8Array(await new Response(stream).arrayBuffer());
        } catch {
            // A browser without a working deflater can still write the compatible
            // uncompressed byte-string format.
            compressed = null;
        }
    }
    const encodedBytes = compressed ?? sceneBytes;
    const payload = JSON.stringify({
        version: "1",
        encoding: "bstring",
        compressed: compressed !== null,
        encoded: byteString(encodedBytes),
    });
    // Upstream's PNG tEXt chunk is ISO-8859-1. The encoded field is a byte
    // string, not Unicode text; preserve each byte rather than UTF-8 encoding it.
    const body = Uint8Array.from(payload, (character) => character.charCodeAt(0));
    const keyword = TEXT_ENCODER.encode(PNG_SCENE_KEYWORD);
    const data = new Uint8Array(keyword.length + 1 + body.length);
    data.set(keyword);
    data.set(body, keyword.length + 1);
    return data;
}

function pngChunk(type, data) {
    const typeBytes = TEXT_ENCODER.encode(type);
    const output = new Uint8Array(data.length + 12);
    new DataView(output.buffer).setUint32(0, data.length);
    output.set(typeBytes, 4);
    output.set(data, 8);
    new DataView(output.buffer).setUint32(output.length - 4, crc32(output.subarray(4, output.length - 4)));
    return output;
}

async function sceneFromTextChunk(data, checkDocumentBytes) {
    const separator = data.indexOf(0);
    const metadata = data.subarray(separator + 1);
    checkDocumentBytes(metadata.length);
    const payloadText = byteString(metadata);
    let payload;
    try {
        payload = JSON.parse(payloadText);
    } catch {
        throw new Error("invalid embedded scene metadata in PNG");
    }
    // Older Excalidraw images stored the scene JSON directly in the text chunk.
    if (payload?.type === "excalidraw") {
        return payloadText;
    }
    if (payload?.encoding !== "bstring" || typeof payload.encoded !== "string") {
        throw new Error("unsupported embedded scene encoding in PNG");
    }
    const bytes = Uint8Array.from(payload.encoded, (character) => character.charCodeAt(0));
    if (payload.compressed === false) {
        checkDocumentBytes(bytes.length);
        return TEXT_DECODER.decode(bytes);
    }
    if (payload.compressed !== true) {
        throw new Error("unsupported embedded scene compression in PNG");
    }
    if (typeof DecompressionStream !== "function") {
        throw new Error("compressed PNG scene metadata is not supported by this browser");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            checkDocumentBytes(total);
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel(error).catch(() => {});
        throw error;
    }
    const decoded = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        decoded.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return TEXT_DECODER.decode(decoded);
}

/** Add the upstream-compatible Excalidraw scene text chunk to a PNG blob. */
export async function embedPngScene(blob, scene) {
    if (scene == null) {
        return blob;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isPng(bytes)) {
        throw new Error("cannot embed a scene in a non-PNG file");
    }
    const metadata = pngChunk("tEXt", await textChunk(scene));
    const chunks = [bytes.subarray(0, PNG_SIGNATURE.length)];
    let offset = PNG_SIGNATURE.length;
    let ended = false;
    while (offset < bytes.length) {
        const chunk = chunkAt(bytes, offset);
        const dataStart = offset + 8;
        const data = bytes.subarray(dataStart, dataStart + chunk.length);
        const remove = chunk.type === "tEXt" && sceneKeyword(data) === PNG_SCENE_KEYWORD;
        if (chunk.type === "IEND") {
            chunks.push(metadata, bytes.subarray(offset, chunk.end));
            ended = true;
            offset = chunk.end;
            break;
        }
        if (!remove) {
            chunks.push(bytes.subarray(offset, chunk.end));
        }
        offset = chunk.end;
    }
    if (!ended) {
        throw new Error("malformed PNG: missing IEND chunk");
    }
    if (offset < bytes.length) {
        chunks.push(bytes.subarray(offset));
    }
    return new Blob(chunks, { type: "image/png" });
}

/** Read an upstream-compatible Excalidraw scene from a PNG, or return null if absent. */
export async function extractPngScene(blob, { checkDocumentBytes = () => {} } = {}) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isPng(bytes)) {
        throw new Error("file is not a PNG");
    }
    let offset = PNG_SIGNATURE.length;
    let found = null;
    let ended = false;
    while (offset < bytes.length) {
        const chunk = chunkAt(bytes, offset);
        const dataStart = offset + 8;
        if (chunk.type === "tEXt") {
            const data = bytes.subarray(dataStart, dataStart + chunk.length);
            if (sceneKeyword(data) === PNG_SCENE_KEYWORD) {
                if (found !== null) {
                    throw new Error("PNG contains duplicate embedded scenes");
                }
                const stored = new DataView(
                    bytes.buffer,
                    bytes.byteOffset + dataStart + chunk.length,
                    4,
                ).getUint32(0);
                if (crc32(bytes.subarray(offset + 4, dataStart + chunk.length)) !== stored) {
                    throw new Error("invalid embedded scene checksum in PNG");
                }
                found = await sceneFromTextChunk(data, checkDocumentBytes);
            }
        }
        offset = chunk.end;
        if (chunk.type === "IEND") {
            ended = true;
            break;
        }
    }
    if (!ended) {
        throw new Error("malformed PNG: missing IEND chunk");
    }
    return found;
}
