
import { blake3 } from '@noble/hashes/blake3.js';
import * as ed from '@noble/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export interface OpenSealResponse {
    result: any;
    openseal: {
        signature: string;
        pub_key: string;
        a_hash: string;
        b_hash: string;
    };
}

export interface VerificationResult {
    valid: boolean;
    signatureVerified: boolean;
    identityVerified: boolean;
    message: string;
}

export class OpensealVerifier {
    /**
     * Verifies the OpenSeal response.
     * 
     * @param response The full JSON response object received from the provider.
     * @param wax The random challenge string sent in the request.
     * @param expectedRootHash (Optional) The expected Golden Truth Root Hash (Hex).
     * @returns VerificationResult
     */
    static async verify(
        response: OpenSealResponse,
        wax: string,
        expectedRootHash?: string
    ): Promise<VerificationResult> {
        try {
            const { openseal, result } = response;
            if (!openseal || !result) {
                return { valid: false, signatureVerified: false, identityVerified: false, message: "Missing openseal or result fields" };
            }

            const { signature, pub_key, a_hash, b_hash } = openseal;
            if (!signature || !pub_key || !a_hash || !b_hash) {
                return { valid: false, signatureVerified: false, identityVerified: false, message: "Incomplete openseal metadata" };
            }

            // 1. Reconstruct Result Hash (Blake3Hex)
            // Note: We assume result is faithfully represented as JSON string.
            // In a real generic implementation, canonicalization is hard. 
            // Ideally, 'result' is simple or the provider sent the string they signed.
            // Here we reproduce the Rust server's behavior: 
            // if string -> use directly, else -> serde_json::to_string (JSON.stringify)
            let resultStr: string;
            if (typeof result === 'string') {
                resultStr = result;
            } else {
                resultStr = JSON.stringify(result);
            }

            const resultBytes = new TextEncoder().encode(resultStr);
            const resultHashBytes = blake3(resultBytes);
            const resultHashHex = bytesToHex(resultHashBytes);

            // 2. Reconstruct Payload
            // Payload Rule: wax + a_hash + b_hash + result_hash_hex
            // (All as UTF-8 strings concatenated)
            const payloadString = `${wax}${a_hash}${b_hash}${resultHashHex}`;
            const payloadBytes = new TextEncoder().encode(payloadString);

            // 3. Verify Signature
            const signatureBytes = hexToBytes(signature);
            const pubKeyBytes = hexToBytes(pub_key);

            const isValidSignature = await ed.verifyAsync(signatureBytes, payloadBytes, pubKeyBytes);

            if (!isValidSignature) {
                return {
                    valid: false,
                    signatureVerified: false,
                    identityVerified: false,
                    message: "Signature verification failed"
                };
            }

            // 4. Verify Identity (A-Hash)
            let isIdentityValid = true;
            if (expectedRootHash) {
                const calculatedAHash = this.computeAHash(expectedRootHash, wax);
                if (calculatedAHash !== a_hash) {
                    isIdentityValid = false;
                }
            }

            if (expectedRootHash && !isIdentityValid) {
                return {
                    valid: false,
                    signatureVerified: true,
                    identityVerified: false,
                    message: "Identity Mismatch: Code execution identity does not match expected root hash."
                };
            }

            return {
                valid: true,
                signatureVerified: true,
                identityVerified: true,
                message: "✅ SEAL VALID"
            };

        } catch (e: any) {
            return {
                valid: false,
                signatureVerified: false,
                identityVerified: false,
                message: `Verification Error: ${e.message}`
            };
        }
    }

    /**
     * Computes the Blinded Identity (A-Hash).
     * A = Blake3("OPENSEAL_BLINDED_IDENTITY" || RootHashBytes || WaxBytes)
     */
    static computeAHash(rootHashHex: string, wax: string): string {
        const rootHashBytes = hexToBytes(rootHashHex);
        const waxBytes = new TextEncoder().encode(wax);
        const prefixBytes = new TextEncoder().encode("OPENSEAL_BLINDED_IDENTITY");

        const hasher = blake3.create({});
        hasher.update(prefixBytes);
        hasher.update(rootHashBytes);
        hasher.update(waxBytes);

        return bytesToHex(hasher.digest());
    }
}
