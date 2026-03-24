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
app.use(express.static('public'));

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
  // Only sending confirmed columns (name, email, budget, message)
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
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New Proposal from ${name}`,
      html: `
        <h2>New Contact Submission</h2>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Project Type:</b> ${projectType}</p>
        <p><b>Budget:</b> ${budget}</p>
        <p><b>Message:</b><br>${message}</p>
      `
    });
  } catch (e) {
    console.error('Email error:', e.message);
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

app.get('/', (req, res) => {
  res.sendFile(path.resolve('public/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.resolve('public/admin.html'));
});

module.exports = app;
