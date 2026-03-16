require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const twilio = require('twilio');
const pikudHaoref = require('pikud-haoref-api');
const session = require('express-session');

// Load city list for the dashboard dropdown
const citiesData = require("pikud-haoref-api/cities.json");
const cityList = citiesData.filter(c => c.value !== 'all').sort((a, b) => a.name.localeCompare(b.name));

const app = express();

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'red-alert-770-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// MySQL connection pool
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'redalarm'
});

// Twilio client configuration
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// ---------- ROBUST CITY EXTRACTOR ----------
function extractCitiesFromAlert(alert) {
    let cities = [];
    try {
        if (Array.isArray(alert)) {
            cities = alert;
        } else if (alert && typeof alert === 'object') {
            if (alert.data && Array.isArray(alert.data)) {
                cities = alert.data;
            } else if (alert.data && typeof alert.data === 'string') {
                cities = [alert.data];
            }
        } else if (typeof alert === 'string') {
            const parsed = JSON.parse(alert);
            if (Array.isArray(parsed)) {
                cities = parsed;
            } else if (parsed.data) {
                cities = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
            }
        }
    } catch (e) {
        console.error("Critical Parsing Error:", e.message);
    }
    return cities;
}

// ---------- AUTH MIDDLEWARE ----------
const isAuthenticated = (req, res, next) => {
    if (req.session.phone) return next();
    res.redirect('/login');
};

// ---------- AUTH ROUTES ----------

app.get('/login', (req, res) => {
    res.send(`
        <head>
            <link rel="stylesheet" href="/style.css">
            <title>Login</title>
        </head>
        <body dir="rtl">
            <div class="container">
                <h2>התחברות למערכת</h2>
                <form action="/login" method="POST">
                    <div style="display: flex; gap: 5px; direction: ltr; margin-bottom: 15px;">
                        <select name="countryCode" style="width: 35%; padding: 10px; border-radius: 4px;">
                            <option value="+972" selected>🇮🇱 +972</option>
                            <option value="+1">🇺🇸 +1</option>
                            <option value="+44">🇬🇧 +44</option>
                        </select>
                        <input name="phoneBody" placeholder="0501234567" required style="flex-grow: 1; padding: 10px; border-radius: 4px;">
                    </div>
                    <button type="submit" class="btn-primary">שלח קוד אימות</button>
                </form>
            </div>
        </body>`);
});

app.post('/login', (req, res) => {
    let { countryCode, phoneBody } = req.body;
    let cleanNumber = phoneBody.replace(/\D/g, ''); // Remove dashes/spaces

    // Leading zero logic: 0501234567 becomes +972501234567
    if (countryCode === '+972' && cleanNumber.startsWith('0')) {
        cleanNumber = cleanNumber.substring(1);
    }

    const finalPhone = countryCode + cleanNumber;
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    db.execute(
        'INSERT INTO users (phone_number, verification_code) VALUES (?, ?) ON DUPLICATE KEY UPDATE verification_code = ?',
        [finalPhone, code, code],
        (err) => {
            if (err) return console.error("Database Error:", err);
            
            twilioClient.messages.create({
                body: `Your verification code: ${code}`,
                to: finalPhone,
                from: process.env.TWILIO_PHONE
            })
            .then(() => {
                console.log(`SMS verification sent to ${finalPhone}`);
                res.send(`
                    <head><link rel="stylesheet" href="/style.css"></head>
                    <body dir="rtl">
                        <div class="container">
                            <form action="/verify" method="POST">
                                <input type="hidden" name="phone" value="${finalPhone}">
                                <p>הזן את הקוד שנשלח למספר: ${finalPhone}</p>
                                <input name="code" placeholder="הכנס קוד" required>
                                <button type="submit" class="btn-primary">אמת והתחבר</button>
                            </form>
                        </div>
                    </body>`);
            })
            .catch(e => console.error("Twilio Error:", e.message));
        }
    );
});

app.post('/verify', (req, res) => {
    const { phone, code } = req.body;
    db.execute(
        'SELECT * FROM users WHERE phone_number = ? AND verification_code = ?',
        [phone, code],
        (err, results) => {
            if (results?.length > 0) {
                db.execute('UPDATE users SET is_verified = TRUE WHERE phone_number = ?', [phone], () => {
                    req.session.phone = phone;
                    console.log(`User ${phone} verified.`);
                    res.redirect('/');
                });
            } else {
                res.send("קוד לא תקין");
            }
        }
    );
});

// ---------- DASHBOARD ROUTES ----------

app.get('/', isAuthenticated, (req, res) => {
    db.execute('SELECT * FROM users WHERE phone_number = ?', [req.session.phone], (err, results) => {
        const user = results[0];
        const cityOptions = cityList.map(c => `<option value="${c.value}">${c.value}</option>`).join('');
        res.send(`
            <head><link rel="stylesheet" href="/style.css"></head>
            <body dir="rtl">
                <div class="container">
                    <h1>מערכת התרעות</h1>
                    <p>עיר נבחרת: <b>${user.city_hebrew || 'ללא'}</b></p>
                    <form action="/update-city" method="POST">
                        <input list="city-list" name="city" id="city-input" placeholder="חפש עיר..." required>
                        <datalist id="city-list">${cityOptions}</datalist>
                        <button type="submit" class="btn-success">עדכן עיר</button>
                    </form>
                    <form action="/test-call" method="POST"><button type="submit" class="btn-secondary">שיחת בדיקה</button></form>
                    <a href="/logout" class="logout-link">התנתק</a>
                </div>
            </body>`);
    });
});

app.post('/update-city', isAuthenticated, (req, res) => {
    db.execute('UPDATE users SET city_hebrew = ? WHERE phone_number = ?', [req.body.city, req.session.phone], () => {
        console.log(`User ${req.session.phone} updated location to ${req.body.city}`);
        res.redirect('/');
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ---------- VOICE LOGIC ----------

function makeVoiceCall(phone, mp3) {
    return twilioClient.calls.create({
        url: `${process.env.SERVER_URL}/voice?mp3=${mp3}`,
        to: phone,
        from: process.env.TWILIO_PHONE
    });
}

app.all('/voice', (req, res) => {
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="2"/><Play>${process.env.SERVER_URL}/${req.query.mp3 || 'alert.mp3'}</Play></Response>`);
});

// ---------- REAL-TIME MONITORING ----------

setInterval(() => {
    pikudHaoref.getActiveAlerts((err, alerts) => {
        if (err || !alerts || alerts.length === 0) return;

        alerts.forEach(alert => {
            const alertId = alert.id;
            const alertCities = extractCitiesFromAlert(alert);
            var mp3;
            // Accurate Title Detection
            const title = alert.title || "Red Alert";

            if(title == "בדקות הקרובות צפויות להתקבל התרעות באזורך")
                mp3 = "soon.mp3";
            else if(titl == "האירוע הסתיים")
                mp3 = "release.mp3";
            else
                mp3 = "alert.mp3";
            // const mp3 = (title.includes("הסתיים")) ? "release.mp3" : "alert.mp3";

            if (alertCities.length > 0) {
                // Check database for users in these cities who haven't been called for THIS alert id
                db.query(
                    'SELECT phone_number, city_hebrew FROM users WHERE city_hebrew IN (?) AND is_verified = TRUE AND (last_alert_id IS NULL OR last_alert_id != ?)',
                    [alertCities, alertId],
                    (dbErr, results) => {
                        if (dbErr) return console.error("Query Error:", dbErr);

                        if (results?.length > 0) {
                            console.log(`NEW ALERT: ${title} | Impacting ${alertCities.length} areas.`);
                            
                            results.forEach(user => {
                                console.log(`>>> DIALING: ${user.phone_number} (${user.city_hebrew})`);
                                
                                // Update user's last called alert ID immediately to prevent duplicate calls
                                db.execute('UPDATE users SET last_alert_id = ? WHERE phone_number = ?', [alertId, user.phone_number]);
                                
                                makeVoiceCall(user.phone_number, mp3).catch(e => console.error("Call Error:", e.message));
                            });
                        }
                    }
                );
            }
        });
    });
}, 2000);

app.post('/test-call', isAuthenticated, (req, res) => {
    makeVoiceCall(req.session.phone, 'alert.mp3').then(() => {
        console.log(`Manual test call triggered for ${req.session.phone}`);
        res.redirect('/');
    }).catch(e => console.log(e.message));
});

app.listen(3000, () => console.log('🚀 Monitoring System Active on http://localhost:3000'));