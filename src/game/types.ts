export type Bit = 0 | 1;

export interface CiphertextView {
  readonly bytes: Uint8Array;
  readonly iv?: Uint8Array;
  readonly body?: Uint8Array;
  readonly parts?: readonly Uint8Array[];
}

export interface EncryptionOracle {
  encrypt(message: Uint8Array): Promise<CiphertextView>;
}

export interface DecryptionOracle {
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array | null>;
}

export interface CcaChallengeView {
  readonly ciphertext: Uint8Array;
  readonly messages: readonly [Uint8Array, Uint8Array];
}

export interface CcaAdversary {
  readonly id: string;
  readonly label: string;
  guess(view: CcaChallengeView, oracle: DecryptionOracle): Promise<Bit>;
}

export interface TextbookRsaPublicKey {
  readonly n: bigint;
  readonly e: bigint;
}

export interface TextbookSigningOracle {
  sign(message: bigint): Promise<bigint>;
}

export interface TextbookForgeryCandidate {
  readonly message: bigint;
  readonly signature: bigint;
  readonly queried: readonly bigint[];
}

export interface TextbookForgeryAdversary {
  readonly id: string;
  forge(
    publicKey: TextbookRsaPublicKey,
    oracle: TextbookSigningOracle,
  ): Promise<TextbookForgeryCandidate>;
}

export interface EcdsaMutationCandidate {
  readonly signature: Uint8Array;
  readonly r: bigint;
  readonly s: bigint;
  readonly malleatedS: bigint;
}

export interface EcdsaMutationAdversary {
  readonly id: string;
  mutate(signature: Uint8Array, order: bigint): EcdsaMutationCandidate;
}

export interface SignatureMutationAdversary {
  readonly id: string;
  mutate(signature: Uint8Array): Uint8Array;
}

export interface IntegerOracle {
  query(input: number): number;
}

export interface SwitchingAdversary {
  readonly id: string;
  readonly label: string;
  guess(queries: number, oracle: IntegerOracle): Bit;
}

export interface ChallengeView {
  readonly ciphertext: CiphertextView;
  readonly messages: readonly [Uint8Array, Uint8Array];
  readonly schemeId: string;
}

export interface CpaAdversary {
  readonly id: string;
  readonly label: string;
  guess(view: ChallengeView, oracle: EncryptionOracle): Promise<Bit>;
}

export interface CpaScheme {
  readonly id: string;
  readonly label: string;
  readonly family: 'public-key' | 'symmetric';
  readonly broken: boolean;
  readonly detail: string;
  readonly messages: readonly [Uint8Array, Uint8Array];
  challenge(message: Uint8Array): Promise<CiphertextView>;
  oracle: EncryptionOracle;
}

export interface TrialTrace {
  readonly bit: Bit;
  readonly guess: Bit;
  readonly won: boolean;
  readonly scheme: string;
  readonly adversary: string;
  readonly ciphertext: string;
  readonly events: readonly string[];
}

export interface ExperimentCounts {
  wins: number;
  losses: number;
  errors: number;
  trials: number;
}

export interface ExperimentResult extends ExperimentCounts {
  readonly trace?: TrialTrace;
  readonly stopped: boolean;
  readonly error?: string;
}