// The PostgreSQL writer is intentionally absent from the production module graph.
// Its synthetic local integration implementation lives under test/support and is
// blocked from normal package imports by package.json exports.
export {};
