require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const path = require('path');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const AWS = require('aws-sdk');
const mailer = require('./mailer');
const blowfish = require('./blowfish');
const db = require('./db');
const crypto = require('crypto');
const { uploadFileToS3, downloadFileFromS3 } = require('./aws');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: 'https://safefileshare.netlify.app',
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(fileUpload());

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true }
}));

// HTTPS certificate options (optional for local dev)
const options = {
    key: fs.readFileSync('./localhost-key.pem'),
    cert: fs.readFileSync('./localhost.pem')
};

// User Registration
app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        const checkQuery = 'SELECT * FROM users WHERE email = ?';
        db.query(checkQuery, [email], async (err, results) => {
            if (err) {
                console.error('Error checking user:', err);
                return res.status(500).json({ message: 'Error checking user.' });
            }
            if (results.length > 0) {
                return res.status(400).json({ message: 'Email already exists.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const insertQuery = 'INSERT INTO users (email, password) VALUES (?, ?)';
            db.query(insertQuery, [email, hashedPassword], (err) => {
                if (err) {
                    console.error('Error registering user:', err);
                    return res.status(500).json({ message: 'Error registering user.' });
                }
                req.session.user = { email };
                return res.status(200).json({ message: 'User registered successfully!' });
            });
        });
    } catch (error) {
        console.error('Internal server error:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

// User Login
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    const query = 'SELECT * FROM users WHERE email = ?';
    db.query(query, [email], async (err, results) => {
        if (err) {
            console.error('Error logging in:', err);
            return res.status(500).json({ message: 'Error logging in.' });
        }
        if (results.length === 0) {
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        req.session.user = { email };
        return res.status(200).json({ message: 'Login successful!' });
    });
});

// File Upload
app.post('/upload', async (req, res) => {
    if (!req.files || !req.files.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    const { email } = req.body;
    const file = req.files.file;
    const encryptionKey = blowfish.generateKey();
    const s3FileKey = crypto.randomBytes(16).toString('hex');
    const uploadPath = path.join(os.tmpdir(), file.name);

    file.mv(uploadPath, async (err) => {
        if (err) {
            console.error('File upload failed:', err);
            return res.status(500).json({ message: 'File upload failed.' });
        }

        try {
            await blowfish.encryptFile(uploadPath, uploadPath, encryptionKey);
            await uploadFileToS3(uploadPath, process.env.AWS_BUCKET_NAME, s3FileKey);

            const emailContent = `
                <p>Your file has been encrypted and stored securely.</p>
                <p>Encryption Key: <strong>${encryptionKey}</strong></p>
                <p>S3 File Key: <strong>${s3FileKey}</strong></p>
            `;
            try {
                await mailer.send(email, 'Your Encryption Keys', emailContent);
                res.status(200).json({ message: 'File uploaded and encrypted successfully! An email with your encryption key and S3 file key has been sent to the provided email.' });
            } catch (emailError) {
                console.error('Email sending failed:', emailError);
                return res.status(500).json({ message: 'File uploaded, but email sending failed. Please check your email configuration.' });
            }
        } catch (err) {
            console.error('Error during file processing:', err);
            res.status(500).json({ message: 'File upload failed.' });
        } finally {
            fs.unlink(uploadPath, (err) => {
                if (err) console.error('Error deleting uploaded file:', err);
            });
        }
    });
});

// File Decryption
app.post('/decrypt', async (req, res) => {
    const { encryptionKey, s3FileKey } = req.body;

    if (!encryptionKey || !s3FileKey) {
        return res.status(400).json({ message: 'Please provide both encryption key and S3 file key.' });
    }

    try {
        const filePath = path.join(os.tmpdir(), `${s3FileKey}.encrypted`);
        const downloadResult = await downloadFileFromS3(s3FileKey, process.env.AWS_BUCKET_NAME, filePath);
        if (!downloadResult) {
            return res.status(500).json({ message: 'Failed to download the file from S3.' });
        }

        const decryptedFilePath = filePath.replace('.encrypted', '');
        await blowfish.decryptFile(filePath, decryptedFilePath, encryptionKey);

        res.download(decryptedFilePath, (err) => {
            if (err) {
                console.error('Error downloading the file:', err);
                return res.status(500).json({ message: 'Error downloading the file.' });
            }

            fs.unlink(decryptedFilePath, (err) => {
                if (err) console.error('Error deleting decrypted file:', err);
            });
        });
    } catch (error) {
        console.error('Error during decryption process:', error);
        res.status(500).json({ message: 'Error during decryption process.' });
    }
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Could not log out.');
        }
        res.status(200).send('Logged out successfully.');
    });
});

app.use((req, res) => {
    res.status(404).send('404 Not Found');
});

app.use((err, req, res, next) => {
    console.error('Something broke:', err);
    res.status(500).send('Something broke!');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.get('/favicon.ico', (req, res) => res.status(204));
