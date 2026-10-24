# Diviyata Saviyak (දිවියට සවියක්)

A web system for the Ministry of Women and Child Affairs, Sri Lanka, to run the Diviyata Saviyak housing programme. It tracks each beneficiary from the Divisional Secretariat's first entry through the Head Office check, the Rs. 2,000,000 release, the four installments and the building stages.

The screens are in Sinhala, Tamil and English, and designed for office PCs.

## Repositories

This repository is the application. The system has two more, in the same GitHub organization:

- **Docs**: the specs (the product, the application, the infrastructure and what the repositories agree on), the changes (each piece of work, from proposal to delivery), the decision records and the runbook.
- **Infrastructure**: the servers, and how they are set up, deployed, backed up and monitored.

## Running it locally

You need Node.js 22 and Docker Desktop.

```bash
cp .env.example .env
npm install
npm run db:up
npx prisma migrate dev
npm run db:seed
npm run dev
```

Then open http://localhost:3000. `CLAUDE.md` lists every command, including the tests.

## Releases

Every push to `main` that passes CI is built from `docker/Dockerfile` into two images, the app and its tools, for amd64 and arm64, tagged with the commit and published to GitHub's container registry (`.github/workflows/release.yml`). Then:

1. Trivy scans both images. A HIGH or CRITICAL vulnerability that has a fix stops the release; `.trivyignore` lists the accepted ones, each with its reason and an expiry date.
2. Both images are signed with the release key, which stays in AWS KMS, and get their SBOMs (the list of everything inside) attached as signed attestations.
3. The Infrastructure repository's Promote workflow checks the signatures and deploys the release to staging. Production is a pull request there that names the same images.

Nothing is deployed from here. Because a deploy runs a release's migrations while the previous release is still answering, every migration must work beside the code before it (`CLAUDE.md`, "Migrations without downtime").

## Data protection

This system holds personal data about children and vulnerable families. Real data never goes into this repository, its tests or its fixtures. Use made-up people only.
