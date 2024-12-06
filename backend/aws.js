const AWS = require('aws-sdk');
const fs = require('fs');

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
    region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

const uploadFileToS3 = async (filePath, bucketName, key) => {
    try {
        const fileStream = fs.createReadStream(filePath);
        const uploadParams = {
            Bucket: bucketName,
            Key: key,
            Body: fileStream,
        };

        const data = await s3.upload(uploadParams).promise();
        console.log(`File uploaded successfully at ${data.Location}`);
        return data;
    } catch (err) {
        console.error('Error uploading to S3:', err);
        throw err; 
    }
};

const downloadFileFromS3 = (s3FileKey, bucketName, savePath) => {
    const s3 = new AWS.S3();
    const params = {
        Bucket: bucketName,
        Key: s3FileKey,
    };

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(savePath);
        s3.getObject(params)
            .createReadStream()
            .on('end', () => {
                console.log('File downloaded successfully');
                resolve(true);
            })
            .on('error', (error) => {
                console.error('Error downloading file:', error);
                reject(error); 
            })
            .pipe(file);
    });
};

module.exports = { uploadFileToS3, downloadFileFromS3 };
