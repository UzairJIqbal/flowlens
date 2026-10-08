// The explanation prompt before the current one, kept here and not in the app:
// shipping a dead prompt so an eval can reach it is the eval shaping the
// product.
//
// Reconstructed, not recovered. The first draft was never committed; git's
// history begins with the current prompt. This is that draft as it was before
// phase 10 tightened it: a persona, "concise", markdown forbidden outright, and
// a one-line rule about other files. What the current one added is what this
// lacks: the neighbours framed as the point of the explanation, a word limit,
// paths in backticks exactly as listed, describe-don't-judge, and three
// permitted kinds of formatting instead of none.
//
// It is sent the same message as the current prompt, so the system prompt is
// the only thing that differs between the two experiments.

export const RETIRED_FILE_SYSTEM = `You are an expert software engineer. Explain what the following file does for a developer who is new to the codebase. Be concise. Use plain text only, with no markdown. Do not mention files that are not listed.`;
