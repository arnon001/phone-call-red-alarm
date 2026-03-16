# Phone Call Red Alarm

A Node.js bot that monitors real-time rocket/missile alerts from the Israeli Home Front Command (Pikud HaOref) and automatically places phone calls to registered users when an alert is active in their city.

## How It Works

1. Users register with their phone number and verify via an SMS code (sent through Twilio).
2. After logging in, each user selects their city from the dashboard.
3. The server polls the Pikud HaOref API every 2 seconds for active alerts.
4. When an alert is detected, the system queries the database for verified users in the affected cities and immediately calls each of them.
5. The call plays an audio alert relevant to the alert type (incoming alert, imminent alert, or all-clear).

## Features

- SMS-based phone number verification (no passwords)
- City selection via a searchable dropdown
- Automatic voice calls via Twilio when your city is under alert
- Deduplication — each user is called only once per unique alert ID
- Test call button to verify your setup works
- Session-based authentication

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Web framework | Express 5 |
| Database | MySQL (mysql2) |
| Alert data | pikud-haoref-api |
| Phone calls & SMS | Twilio |
| Auth | express-session |
| Config | dotenv |

## Prerequisites

- Node.js 18+
- MySQL server with a database named `redalarm`
- A [Twilio](https://www.twilio.com/) account with a phone number
- A publicly accessible URL for the server (required for Twilio voice webhooks)

## Database Setup

Run the following SQL to create the required table:

```sql
CREATE DATABASE IF NOT EXISTS redalarm;
USE redalarm;

CREATE TABLE users (
    phone_number VARCHAR(20) PRIMARY KEY,
    verification_code VARCHAR(6),
    is_verified BOOLEAN DEFAULT FALSE,
    city_hebrew VARCHAR(100),
    last_alert_id VARCHAR(100)
);
```

## Installation

```bash
git clone https://github.com/arnon001/phone-call-red-alarm.git
cd phone-call-red-alarm
npm install
```

## Configuration

Create a `.env` file in the project root:

```env
TWILIO_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE=+1234567890
SERVER_URL=https://your-public-domain.com
```

> `SERVER_URL` must be a publicly reachable URL so Twilio can fetch the TwiML voice instructions. Use a tool like [ngrok](https://ngrok.com/) for local development.

## Running

```bash
node index.js
```

The server starts on **http://localhost:3000**.

## Audio Files

Place the following MP3 files in the project root:

| File | Played when |
|------|-------------|
| `alert.mp3` | A standard rocket alert is active |
| `soon.mp3` | Alerts are expected in your area shortly |
| `release.mp3` | The alert event has ended |

## License

MIT © [Arnon Hacohen](https://github.com/arnon001)
