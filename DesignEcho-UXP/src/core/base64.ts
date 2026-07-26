export function base64ToUint8Array(base64: string): Uint8Array {
    const cleanBase64 = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
    const binaryString = atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i) & 0xff;
    }
    return bytes;
}
