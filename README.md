# Student Organization Fund Tracker

A web app for a student organization to collect fees, track fund balances, handle fund requests and receipts, and let students check their payment status by QR code.

## Features

- Student records, with CSV import and self-enrollment links
- Fee collection with digital receipts and a QR status page
- Fund balances and a full money history per fund
- Fund requests, approvals and liquidation receipts
- Email and in-app notifications
- Dashboard and printable reports (PDF, CSV)
- Each academic year kept separate

## Tech stack

- **Web:** React, Vite, Tailwind CSS
- **API:** Node.js, Express, Prisma
- **Database:** PostgreSQL

## Setup

Requires **Node.js 22+** and **PostgreSQL 16**.

1. Install dependencies:
   ```bash
   npm install
   ```
2. In `apps/api/.env`, set your PostgreSQL password.
3. Create the tables and sample data:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
4. Put your organization's name in `apps/api/src/branding.ts`, and its logo (optional) in `apps/api/branding/`.
5. Start the app:
   ```bash
   npm run dev
   ```
6. Open http://localhost:5173 and sign up. The first account becomes the **adviser** and sets up the academic year. Officers sign up after that and wait for the adviser's approval.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app |
| `npm test` | Run the tests |
| `npm run build` | Build for production |
| `npm start` | Run the production build |
