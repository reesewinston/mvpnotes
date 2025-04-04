// Import required modules
const Tesseract = require('tesseract.js');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const upload = multer(); // For parsing multipart/form-data
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(express.json());

// Serve static files from React build folder
app.use(express.static(path.join(__dirname, '../client/build')));

// ========================================================
// Authentication Routes using Supabase Auth
// ========================================================

// Registration endpoint using Supabase Auth
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    console.log(`Received registration request for email: ${email}`);

    // Email validation
    const emailPattern = /@(spelman\.edu|morehouse\.edu)$/;
    if (!emailPattern.test(email)) {
        return res.status(400).json({ success: false, message: 'Email must end with @spelman.edu or @morehouse.edu.' });
    }

    try {
        // Register user in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } } // Store additional user info
        });

        if (error) throw error;

        res.json({ success: true, message: 'Registration successful. Check your email for verification.' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: error.message || 'Error registering user' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received login request for email: ${email}`);

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        res.json({ success: true, message: 'Login successful', user: data.user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
});

// Email verification using 6-digit code
app.post('/verify', async (req, res) => {
    const { email, verificationCode } = req.body;
    console.log(`Verifying email: ${email} with code: ${verificationCode}`);

    try {
        const { data, error } = await supabase.auth.verifyOtp({
            email,
            token: verificationCode,
            type: 'signup'
        });

        if (error) {
            console.error('Verification failed:', error);
            return res.status(400).json({ success: false, message: 'Invalid verification code.' });
        }

        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ success: false, message: 'Error verifying email' });
    }
});

// Upload note route
// Updated upload-note route with OCR
// Upload note route with OCR (JPEG/PNG only)
app.post('/upload-note', upload.single('file'), async (req, res) => {
    const { title, description, subject, email, semester, class_code, professor, department } = req.body;
    const file = req.file;
  
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  
    try {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
  
      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('notes')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });
  
      if (uploadError) throw uploadError;
  
      const file_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/notes/${fileName}`;
  
      // Run OCR ONLY for supported image types
      let ocrText = '';
      if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
        try {
          const ocrResult = await Tesseract.recognize(file.buffer, 'eng', {
            logger: m => console.log(`OCR Progress: ${m.status} ${Math.round(m.progress * 100)}%`)
          });
          ocrText = ocrResult.data.text;
        } catch (err) {
          console.error('OCR failed:', err);
        }
      } else {
        console.log(`Skipping OCR — unsupported file type: ${file.mimetype}`);
      }
  
      // Save note metadata + OCR text to Supabase
      const { data: insertData, error: insertError } = await supabase
        .from('notes')
        .insert([{ 
          title,
          description,
          subject,
          file_url,
          uploaded_by: email,
          semester,
          class_code,
          professor,
          department,
          ocr_text: ocrText
        }])
        .select();
  
      if (insertError) throw insertError;
  
      res.json({ success: true, message: 'Note uploaded successfully', note: insertData[0] });
    } catch (error) {
      console.error('Upload/OCR error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
// Get notes route
// GET /notes with filters
app.get('/notes', async (req, res) => {
    const { semester, department, professor, class_code } = req.query;

    let query = supabase.from('notes').select('*');

    if (semester) query = query.eq('semester', semester);
    if (department) query = query.eq('department', department);
    if (professor) query = query.ilike('professor', `%${professor}%`);
    if (class_code) query = query.ilike('class_code', `%${class_code}%`);

    query = query.order('timestamp', { ascending: false });

    try {
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, notes: data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Fallback route to serve React frontend for any unmatched routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

app.get('/test-db-access', async (req, res) => {
    try {
      // Test insert
      const { data, error } = await supabase
        .from('notes')
        .insert([{
          title: 'Test Note',
          description: 'Testing database access',
          subject: 'Debug',
          file_url: 'https://www.see.leeds.ac.uk/geo-maths/basic_maths.pdf',
          uploaded_by: 'test@spelman.edu'
        }])
        .select();
      
      if (error) {
        console.error('Test insert failed:', error);
        return res.status(500).json({ success: false, error });
      }
      
      res.json({ success: true, message: 'Database access working properly', data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

// Start the server
const PORT = process.env.PORT || 5000;


  
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});