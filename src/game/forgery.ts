import { ecdsaHighSTwin } from '../adversaries/ecdsa-high-s';
import { flipFirstSignatureBit } from '../adversaries/signature-bitflip';
import { rsaBlindingForgery } from '../adversaries/rsa-blinding';
import { rsaMultiplicativeForgery } from '../adversaries/rsa-multiplicative';
import { signEcdsa, verifyEcdsaLowS, verifyEcdsaPlain } from '../schemes/ecdsa';
import { signEd25519, verifyEd25519 } from '../schemes/ed25519';
import { signPss, verifyPss } from '../schemes/rsa-pss';
import {
  getRsaMaterial,
  textbookSign,
  textbookVerify,
} from '../schemes/rsa-textbook';
import { textEncoder, toHex } from '../schemes/utils';

export type ForgeryScheme = 'rsa-multiplicative' | 'rsa-blinding' | 'ecdsa-malleation' | 'rsa-pss' | 'ed25519';

export interface ForgeryResult {
  readonly scheme: ForgeryScheme;
  readonly alarm: boolean;
  readonly accepted: boolean;
  readonly verdict: string;
  readonly explanation: string;
  readonly values: Readonly<Record<string, string>>;
  /**
   * Per-verifier outcomes the page renders as their own verdicts. These are the
   * real return values of the real verifiers; the banners branch on them rather
   * than restating what the exhibit is supposed to show.
   */
  readonly verifiers?: Readonly<Record<'plain' | 'lowS', boolean>>;
}

export async function runForgery(scheme: ForgeryScheme): Promise<ForgeryResult> {
  if (scheme === 'rsa-multiplicative') {
    const material = await getRsaMaterial();
    const candidate = await rsaMultiplicativeForgery.forge(
      { n: material.n, e: material.e },
      { sign: async (message) => textbookSign(message, material) },
    );
    const accepted = textbookVerify(candidate.message, candidate.signature, material);
    return {
      scheme,
      alarm: accepted,
      accepted,
      verdict: accepted ? 'FORGED: verifier accepted an unqueried message' : 'REJECTED',
      explanation: 'Raw RSA preserves multiplication: sig(2) times sig(3) is sig(6) modulo n.',
      values: {
        queried: candidate.queried.join(', '),
        forgedMessage: candidate.message.toString(),
        forgedSignature: `0x${candidate.signature.toString(16)}`,
        modulus: `0x${material.n.toString(16)}`,
        exponent: material.e.toString(),
      },
    };
  }

  if (scheme === 'rsa-blinding') {
    const material = await getRsaMaterial();
    const candidate = await rsaBlindingForgery.forge(
      { n: material.n, e: material.e },
      { sign: async (message) => textbookSign(message, material) },
    );
    const accepted = textbookVerify(candidate.message, candidate.signature, material);
    return {
      scheme,
      alarm: accepted,
      accepted,
      verdict: accepted ? 'FORGED: blind query became a target signature' : 'REJECTED',
      explanation: 'The oracle signed a blinded representative; division by the blinder exposed sig(7).',
      values: {
        queried: candidate.queried.join(', '),
        target: candidate.message.toString(),
        forgedSignature: `0x${candidate.signature.toString(16)}`,
        modulus: `0x${material.n.toString(16)}`,
        exponent: material.e.toString(),
      },
    };
  }

  if (scheme === 'ecdsa-malleation') {
    const signed = signEcdsa(textEncoder.encode('approve transfer 42'));
    const candidate = ecdsaHighSTwin.mutate(signed.signature, signed.n);
    const plainAccepted = verifyEcdsaPlain(signed.message, candidate.signature, signed.publicKey);
    const lowSAccepted = verifyEcdsaLowS(signed.message, candidate.signature, signed.publicKey);
    return {
      scheme,
      alarm: plainAccepted,
      accepted: plainAccepted,
      verdict: plainAccepted
        ? 'VERIFIES - AND IS A NEW SIGNATURE ON A QUERIED MESSAGE'
        : 'REJECTED',
      explanation: lowSAccepted
        ? 'Unexpected: the default low-S verifier accepted the high-S form.'
        : 'EUF-CMA is not broken because the message was queried; SUF-CMA fails for the plain verifier. The library default rejects high-S.',
      values: {
        messageHex: toHex(signed.message),
        publicKey: toHex(signed.publicKey),
        originalSignature: toHex(signed.signature),
        malleatedSignature: toHex(candidate.signature),
        r: `0x${candidate.r.toString(16)}`,
        s: `0x${candidate.s.toString(16)}`,
        n: `0x${signed.n.toString(16)}`,
        malleatedS: `0x${candidate.malleatedS.toString(16)}`,
        plainVerifier: plainAccepted ? 'accepted' : 'rejected',
        lowSVerifier: lowSAccepted ? 'accepted' : 'rejected',
      },
      verifiers: { plain: plainAccepted, lowS: lowSAccepted },
    };
  }

  const message = textEncoder.encode('approve transfer 42');
  if (scheme === 'rsa-pss') {
    const signature = await signPss(message);
    const candidate = flipFirstSignatureBit.mutate(signature);
    const accepted = await verifyPss(message, candidate);
    return {
      scheme,
      alarm: accepted,
      accepted,
      verdict: accepted ? 'FORGED: altered RSA-PSS signature accepted' : 'REJECTED: altered RSA-PSS signature',
      explanation: 'The real WebCrypto verifier checked the altered signature against the queried message.',
      values: { queriedMessage: 'approve transfer 42', alteredSignature: `${toHex(candidate.slice(0, 12))}...` },
    };
  }

  const signed = signEd25519(message);
  const candidate = flipFirstSignatureBit.mutate(signed.signature);
  const accepted = verifyEd25519(message, candidate, signed.publicKey);
  return {
    scheme,
    alarm: accepted,
    accepted,
    verdict: accepted ? 'FORGED: altered Ed25519 signature accepted' : 'REJECTED: altered Ed25519 signature',
    explanation: 'The strict RFC 8032 verifier checked the altered signature against the queried message.',
    values: { queriedMessage: 'approve transfer 42', alteredSignature: `${toHex(candidate.slice(0, 12))}...` },
  };
}