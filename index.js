const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { google } = require('googleapis');
const cors = require('cors');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'YOUR_REDIRECT_URI'
);

app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync('tokens.json', JSON.stringify(tokens));
  res.send('Authorization successful! You can now upload videos.');
});

app.post('/generate', upload.single('image'), async (req, res) => {
  const { audioUrl, title, description } = req.body;
  const imagePath = req.file.path;
  const audioPath = `downloads/audio-${Date.now()}.mp3`;
  const outputVideo = `videos/output-${Date.now()}.mp4`;

  try {
    // Download audio
    const response = await axios({ url: audioUrl, method: 'GET', responseType: 'stream' });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(audioPath);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Create video
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .loop()
        .input(audioPath)
        .outputOptions('-shortest')
        .output(outputVideo)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Upload to YouTube
    const tokens = JSON.parse(fs.readFileSync('tokens.json'));
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const response2 = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: { title: title || 'Auto Video', description: description || '' },
        status: { privacyStatus: 'public' },
      },
      media: {
        body: fs.createReadStream(outputVideo),
      },
    });

    // Clean up files
    fs.unlinkSync(audioPath);
    fs.unlinkSync(imagePath);
    fs.unlinkSync(outputVideo);

    res.json({ success: true, videoId: response2.data.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
