/**
 * Iron Fost — Biometrics / WebAuthn Service
 * Handles fingerprint registration and identification via browser WebAuthn API.
 */

import api from './api';

// Helper to convert ArrayBuffer to Base64 (needed for storing in DB)
function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

// Helper to convert Base64 to ArrayBuffer
function base64ToBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Check if the current browser/device supports biometrics.
 * Note: Requires localhost or HTTPS.
 */
export async function checkBiometricSupport() {
  if (!window.PublicKeyCredential) return { supported: false, reason: 'Browser does not support biometrics.' };
  
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return { supported: false, reason: 'Security Error: Biometrics require an HTTPS connection.' };
  }

  const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  return { supported: true, available };
}

/**
 * Register a member's fingerprint on ANY device
 */
export async function registerFingerprint(member) {
  const support = await checkBiometricSupport();
  if (!support.supported) throw new Error(support.reason);

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const publicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: "Iron Fost SaaS",
      id: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname,
    },
    user: {
      id: userId,
      name: String(member.phone || member.id),
      displayName: member.name,
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" }, // ES256
      { alg: -257, type: "public-key" } // RS256
    ],
    authenticatorSelection: {
      // REMOVED 'platform' to allow external USB scanners/security keys as well as laptop sensors
      userVerification: "required",
    },
    timeout: 60000,
    attestation: "none" // Set to none for broader compatibility
  };

  try {
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    return bufferToBase64(credential.rawId);
  } catch (err) {
    console.error('Fingerprint registration failed:', err);
    if (err.name === 'NotAllowedError') throw new Error('Biometric request was cancelled or timed out.');
    throw err;
  }
}

/**
 * identify a member via fingerprint
 */
export async function identifyFingerprint() {
  const support = await checkBiometricSupport();
  if (!support.supported) throw new Error(support.reason);

  const res = await api.get('/members');
  const membersWithFingerprints = (res.data.data || []).filter(m => m.fingerprint_id && m.fingerprint_id.length > 0);
  
  if (membersWithFingerprints.length === 0) {
    throw new Error('No fingerprints registered in system yet. Please enroll a member first.');
  }

  const allowedCredentials = membersWithFingerprints.map(m => ({
    id: base64ToBuffer(m.fingerprint_id),
    type: 'public-key'
    // Removed 'transports' to allow all communication methods (NFC, USB, Bluetooth, Internal)
  }));

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const options = {
    challenge,
    allowCredentials: allowedCredentials,
    userVerification: "required",
    timeout: 60000
  };

  try {
    const assertion = await navigator.credentials.get({
      publicKey: options
    });

    const credentialId = bufferToBase64(assertion.rawId);
    const member = membersWithFingerprints.find(m => m.fingerprint_id === credentialId);
    
    if (!member) throw new Error('Fingerprint recognized but no matching member found.');
    return member;
  } catch (err) {
    console.error('Identification failed:', err);
    if (err.name === 'NotAllowedError') throw new Error('Identity verification was cancelled.');
    throw err;
  }
}
