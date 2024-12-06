const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendEmail = (to, subject, htmlContent) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to, 
        subject,
        html: htmlContent,
    };

    return transporter.sendMail(mailOptions);
};

module.exports = { send: sendEmail };
