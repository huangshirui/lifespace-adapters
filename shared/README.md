# Shared Adapter Helpers

`shared/` is reserved for code that is genuinely reusable across more than one LifeSpace protocol adapter.

Allowed examples, once real reuse exists:

- a typed canonical LifeSpace HTTP client used by multiple adapters;
- deterministic Runtime Discovery（运行时发现） projection helpers;
- protocol-neutral compatibility/error metadata utilities.

Not allowed:

- LifeSpace Domain Model（领域模型） ownership;
- Membership / Data Grant / Agent Delegation / Policy authorization logic;
- a copied Model Registry or canonical OpenAPI/JSON Schema source;
- platform migrations or direct D1 access;
- abstractions created only because a second adapter might exist someday.

Until a second real consumer proves the need, prefer keeping code inside the concrete adapter rather than prematurely moving it here.
