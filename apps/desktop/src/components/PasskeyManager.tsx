"use client";

import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { orbitFetch } from '../utils/api';
import { OrbitIdentity } from '@orbit/crypto';
import { logger } from '../utils/logger';

export function PasskeyManager({ identity }: { identity: OrbitIdentity }) {
  const [status, setStatus] = useState<string>('');

  const registerPasskey = async () => {
    try {
      setStatus('Requesting challenge...');
      const res = await orbitFetch('/api/auth/passkeys/register/options', {
        method: 'POST',
      }, identity);

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const { options, sessionId } = await res.json();
      
      setStatus('Waiting for authenticator...');
      const attResp = await startRegistration(options);

      setStatus('Verifying passkey...');
      const verifyRes = await orbitFetch('/api/auth/passkeys/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, response: attResp })
      }, identity);

      if (!verifyRes.ok) {
        throw new Error(await verifyRes.text());
      }

      setStatus('Passkey secured.');
    } catch (e: unknown) {
      logger.error(e);
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="bg-retro-border border border-retro-muted p-4 mt-4">
      <h4 className="font-bold text-retro-fg text-sm mb-2">Vault security</h4>
      <p className="text-xs text-retro-muted mb-4">
        Your private key is currently only protected by local storage. Secure it by linking a WebAuthn Passkey (e.g. TouchID, YubiKey).
      </p>
      <button
        onClick={registerPasskey}
        className="bg-retro-accent text-black px-4 py-2 text-xs font-bold hover:bg-retro-fg hover:text-retro-bg transition-colors"
      >
        Register Passkey
      </button>
      {status && <div className="mt-2 text-xs text-retro-warning font-medium">{status}</div>}
    </div>
  );
}
