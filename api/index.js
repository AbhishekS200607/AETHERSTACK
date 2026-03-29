require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

async function readProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('id', { ascending: false });
  if (error) console.error('Supabase error:', error);
  return data || [];
}

async function readSubmissions() {
  const { data, error } = await supabase.from('submissions').select('*').order('id', { ascending: false });
  if (error) console.error('Supabase error:', error);
  return data || [];
}

async function saveSubmission(data) {
  const { error } = await supabase.from('submissions').insert([
    { 
      id: Date.now(), 
      name: data.name, 
      email: data.email, 
      budget: data.budget, 
      message: data.message 
    }
  ]);
  if (error) console.error('Supabase error:', error);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.post('/api/contact', async (req, res) => {
  const { name, email, projectType, budget, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  await saveSubmission({ name, email, projectType, budget, message });

  try {
    const info = await transporter.sendMail({
      from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `New Proposal from ${name}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #ff6b4a;">New Contact Submission</h2>
          <hr style="border: 0; border-top: 1px solid #eee;" />
          <p><b>Name:</b> ${name}</p>
          <p><b>Email:</b> ${email}</p>
          <p><b>Project Type:</b> ${projectType}</p>
          <p><b>Budget:</b> ${budget}</p>
          <p style="background: #f9f9f9; padding: 15px; border-radius: 8px;"><b>Message:</b><br>${message}</p>
        </div>
      `
    });
    console.log('Email sent successfully:', info.messageId);
  } catch (e) {
    console.error('EMAIL FAILED:', e.message);
    if (e.code === 'EAUTH') {
      console.error('Email authentication failed. Check your EMAIL_PASS app password.');
    }
  }

  res.json({ success: true, message: 'Proposal received!' });
});

app.get('/api/submissions', adminAuth, async (req, res) => {
  res.json(await readSubmissions());
});

function adminAuth(req, res, next) {
  const secret = req.query.secret || req.body.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });    
  next();
}

app.get('/api/projects', async (req, res) => res.json(await readProjects()));

app.post('/api/projects', adminAuth, async (req, res) => {
  const { title, description, tags, imageUrl, link } = req.body;
  if (!title || !description) return res.status(400).json({ error: 'Title and description are required.' });

  const { data, error } = await supabase.from('projects').insert([
    { id: Date.now(), title, description, tags: tags || [], imageUrl: imageUrl || '', link: link || '' }
  ]).select();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

app.put('/api/projects/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('projects')
    .update({ ...req.body, id: Number(req.params.id) })
    .eq('id', Number(req.params.id))
    .select();

  if (error || !data?.length) return res.status(404).json({ error: 'Not found.' });
  res.json(data[0]);
});

app.delete('/api/projects/:id', adminAuth, async (req, res) => {
  await supabase.from('projects').delete().eq('id', Number(req.params.id));
  res.json({ success: true });
});

// 404 handler - must be last
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
