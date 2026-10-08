# Changelog

## [0.2.2](https://github.com/FantasticDevHQ/convex-cf-email-service/compare/v0.2.1...v0.2.2) (2026-10-08)


### Bug Fixes

* preserve idempotent replay after send expiry ([9a83ce5](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/9a83ce56bdd0d7bf9e1267e695312adfdeba4f36))
* preserve idempotent replay after send expiry ([e4039d7](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/e4039d7020d1c6e2795a4d0b77084eae0aa206c6))

## [0.2.1](https://github.com/FantasticDevHQ/convex-cf-email-service/compare/v0.2.0...v0.2.1) (2026-10-08)


### Bug Fixes

* preserve existing GitHub releases during tag publication ([cf739b1](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/cf739b1bb712a4a8f3a91cbafe2bd44a8b540e72))
* preserve existing GitHub releases during tag publication ([fce2f9d](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/fce2f9dedb201ba83e9fea012f91a2b05b7bfc87))

## [0.2.0](https://github.com/FantasticDevHQ/convex-cf-email-service/compare/v0.1.0...v0.2.0) (2026-10-08)


### Features

* implement durable Convex Cloudflare email service ([777f518](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/777f518b68a12f23af81d1b509ddb1b3010b4652))
* implement durable host-owned Cloudflare email component ([8052374](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/80523740fa826670392006129407a648adb284a8))


### Bug Fixes

* validate release bootstrap before creating tags ([18cf086](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/18cf08696bc3dd1ef41b8eeb6b3696f2153430f0))
* validate release bootstrap before creating tags ([4608ccc](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/4608ccc3d4078902566a5801764542f5bb5e513d))


### Maintenance

* import cloudflare email component at ecd56ba ([380fc8d](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/380fc8d91f757f095396098e2fd8a262a22afad7))


### Continuous Integration

* prepare trusted npm releases and independent consumer gates ([655c139](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/655c13906ea9ba0bda1ea1de73b7338d48a31c63))


### Tests

* verify isolated mount returns no foreign intent ([8dfe4f4](https://github.com/FantasticDevHQ/convex-cf-email-service/commit/8dfe4f463b1cdf75cc9457bd8bd9b181adb6ea41))

## 0.1.0 (2026-10-08)

### Features

* Prepare a durable Convex email component with host-owned transports and delivery ingestion.
* Add idempotency, fenced retries, reconciliation, scoped suppression and retention.

No npm release has been published. Release Please manages subsequent version changes.
