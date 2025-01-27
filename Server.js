const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const { nanoid } = require('nanoid');
require('dotenv').config();
const moment = require('moment-timezone');
const multer = require('multer'); 

const app = express();

const PORT = process.env.PORT ;

const email = process.env.EMAIL; // Your email address
const passkey = process.env.PASSKEY; // Your email password (use app-specific password if 2FA is enabled)
// const upload = multer({ dest: 'uploads/' });

// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // Serve frontend files
app.use(bodyParser.json());
app.use(session({
    secret: 'secret-key', // Set your own secret key
    resave: false,
    saveUninitialized: true
}));
app.use(express.json()); // Add this line to parse JSON requests
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const otpStore = {};
const userFilePath = path.join(__dirname, "/db/users.json");

// // API Route to fetch property data
app.get("/api/properties", (req, res) => {
    fs.readFile("./db/data.json", "utf8", (err, data) => {
        if (err) {
            res.status(500).json({ message: "Error reading data file" });
            return;
        }
        res.json(JSON.parse(data));
    });
});

// Endpoint to remove a property
// Endpoint to remove a property
app.delete('/api/properties/:propertyCode', (req, res) => {
    const propertyCode = req.params.propertyCode;

    const DATA_FILE = path.join(__dirname, '/db/data.json');

    fs.readFile(DATA_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading data file:', err);
            res.status(500).send('Internal Server Error');
            return;
        }

        let properties = JSON.parse(data);
        const initialLength = properties.length;
        properties = properties.filter(property => property.propertyCode !== propertyCode);

        if (properties.length === initialLength) {
            res.status(404).send('Property not found');
            return;
        }

        fs.writeFile(DATA_FILE, JSON.stringify(properties, null, 2), 'utf8', (err) => {
            if (err) {
                console.error('Error writing data file:', err);
                res.status(500).send('Internal Server Error');
                return;
            }
            res.sendStatus(204);
        });
    });
});


app.get("/remove", (req, res) => {
    res.sendFile(__dirname + '/removeProperty.html');
});


// OTP Verification
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: email, // Your email address
        pass: passkey, // Your email password (use app-specific password if 2FA is enabled)
    },
});

// Helper function to check if email exists in user.json
function isEmailRegistered(email) {
    if (!fs.existsSync(userFilePath)) {
        return false;
    }
    const users = JSON.parse(fs.readFileSync(userFilePath, "utf-8"));
    return users.some(user => user.email === email);
}

// Login page route
app.get("/login", (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

// Handle form submission
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Ensure this directory exists
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, extension);
        cb(null, `${baseName}-${uniqueSuffix}${extension}`);
    }
});

const upload = multer({ storage: storage });

app.post('/submit', upload.array('propertyPhotos', 10), (req, res) => {
    const formData = req.body;
    const photos = req.files;

    // Format property data
    const formattedData = {
        ...formData,
        propertyCode: nanoid(),
        date: moment().format('M/D/YYYY, h:mm:ss A'),
        propertyPhotos: photos.map(file => file.filename)
    };

    // Save formData to tempdata.json
    const filePath = path.join(__dirname, '/db/tempdata.json');

    fs.readFile(filePath, 'utf8', (err, data) => {
        let jsonData = [];
        if (!err && data) {
            jsonData = JSON.parse(data);
        }
        jsonData.push(formattedData);

        fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), (err) => {
            if (err) {
                console.error('Error writing JSON file:', err);
                return res.status(500).send('Internal Server Error');
            }
            res.json({
                "success": true
              });
        });
    });
});



// // Send OTP Route
app.post("/registraion/send-otp", (req, res) => {
    const { email } = req.body;
    const otp = crypto.randomInt(100000, 999999).toString(); // Generate a 6-digit OTP
    otpStore[email] = otp;

    const mailOptions = {
        from: "your_email@gmail.com",
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP code is: ${otp}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.status(500).json({ message: `Error sending OTP: ${error.message}` });
        }
        res.status(200).json({ message: "OTP sent successfully" });
    });
});


// Send OTP Route
app.post("/login/send-otp", (req, res) => {
    const { email } = req.body;

    if (!isEmailRegistered(email)) {
        return res.status(400).json({ message: "Email does not exist. Please register first." });
    }

    const otp = crypto.randomInt(100000, 999999).toString(); // Generate a 6-digit OTP
    otpStore[email] = otp;

    const mailOptions = {
        from: email,
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP code is: ${otp}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error(`Error sending OTP: ${error.message}`);
            return res.status(500).json({ message: `Error sending OTP: ${error.message}` });
        }
        console.log(`OTP sent: ${info.response}`);
        res.status(200).json({ message: "OTP sent successfully" });
    });
});

// Route to verify the OTP
app.post("/regerster/verify-otp", (req, res) => {
    const { email, otp } = req.body;

    if (otpStore[email] === otp) {
        req.session.user = email; // Store email in session
        delete otpStore[email]; // Remove OTP after successful verification
        res.status(200).send("OTP verified successfully");
    } else {
        res.status(400).send("Invalid OTP");
    }
});
// Assuming you have user data stored in users.json with fields like name and email

app.post("/verify-otp", (req, res) => {
    const { email, otp } = req.body;

    if (otpStore[email] === otp) {
        // Fetch user data from users.json
        const users = JSON.parse(fs.readFileSync(userFilePath, "utf-8"));
        const user = users.find(user => user.email === email);
        
        // Store user name in session
        req.session.user = { name: user.firstName , email: user.email , id: user.id };
        
        delete otpStore[email]; // Remove OTP after successful verification
        res.status(200).send("OTP verified successfully");
    } else {
        res.status(400).send("Invalid OTP");
    }
});

// Registration page route
app.get("/register-page", (req, res) => {
    res.sendFile(__dirname + '/register.html');
});

// Check email route for registration
app.post('/check-email', (req, res) => {
    const email = req.body.email;
    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    // Read the JSON file
    fs.readFile('./db/users.json', 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to read users data' });
        }

        const users = JSON.parse(data);
        const user = users.find(user => user.email === email);

        if (user) {
            return res.status(200).json({ message: 'Email is already registered' });
        } else {
            return res.status(200).json({ message: 'Email is not registered' });
        }
    });
});

// Registration Route
app.post("/register", (req, res) => {
    const { firstName, lastName, email, phoneNumber, city, gender } = req.body;

    // Check if OTP is verified
    if (!req.session.user || req.session.user !== email) {
        return res.status(400).send("OTP verification required");
    }

    // Create user data with a unique ID
    const userData = {
        id: nanoid(), // Generate unique ID using nanoid
        firstName,
        lastName,
        email,
        phoneNumber,
        city,
        gender,
        registrationDate: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    };

    // Read existing users
    const usersFile = "./db/users.json";
    let users = [];

    if (fs.existsSync(usersFile)) {
        const usersData = fs.readFileSync(usersFile, "utf-8"); // Add "utf-8" for proper encoding
        users = JSON.parse(usersData);
    }

    // Add new user to the list
    users.push(userData);

    // Write updated user data to the JSON file
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    res.status(200).send("Registration successful");
});

app.get("/check-session", (req, res) => {
    if (req.session.user) {
        res.json({ 
            loggedIn: true, 
            userName: req.session.user.name,
            userId: req.session.user.id
        });
    } else {
        res.json({ loggedIn: false });
    }
});
// Logout Route
app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send("Error logging out");
        }
        res.redirect("/");
    });
});

// Homepage route
app.get("/",(req,res)=> {
    res.sendFile(__dirname + '/index.html');
    // res.sendFile(__dirname + '/try.html');
});

app.get("/ListMyProperty", (req, res) => {
    res.sendFile(__dirname + '/listProperty.html');
});


// Admin Authentication Route
app.get("/admin/:id/:pass", async (req, res) => {
    try {
        const { id, pass } = req.params;
        // console.log(`Received request: ID = ${id}, Pass = ${pass}`);

        const filePath = path.join(__dirname, "/db/admin.json");
        if (!fs.existsSync(filePath)) {
            console.error("Admin data file not found");
            return res.status(500).send("Admin data file not found");
        }

        const data = await fs.promises.readFile(filePath, "utf8");
        const adminData = JSON.parse(data);
        // console.log("Loaded admin data:", adminData);

        const admin = adminData.find(d => d.adminName === id && d.adminPass === pass);

        if (admin) {
            console.log(`${admin.adminName} logged in successfully.`);
            req.session.admin = admin.adminName;
            // return res.send("Admin Login Successful");
            return res.sendFile(__dirname + '/admin.html');
        } else {
            console.log("Invalid credentials provided.");
            return res.status(400).send("Invalid Admin Credentials");
        }
    } catch (error) {
        console.error("Unexpected error:", error);
        return res.status(500).send("Internal Server Error");
    }
});

app.get('/api/admin/properties', (req, res) => {
    const filePath = path.join(__dirname,'/db/tempdata.json');
   
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading JSON file:', err);
            res.status(500).send('Internal Server Error');
            return;
        }
        res.json(JSON.parse(data));
    });

});


// Helper function to read JSON file
const readJsonFile = (filePath) => {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(JSON.parse(data));
            }
        });
    });
};

// Helper function to write JSON file
const writeJsonFile = (filePath, data) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8', (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

// API endpoint to move an entry from tempdata.json to data.json
app.post('/api/move-entry/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const tempDataPath = path.join(__dirname, 'db', 'tempdata.json');
        const dataPath = path.join(__dirname, 'db', 'data.json');

        // Read tempdata.json
        const tempData = await readJsonFile(tempDataPath);

        // Find the entry with the given ID
        const entryIndex = tempData.findIndex(entry => entry.propertyCode == id);
        if (entryIndex === -1) {
            return res.status(404).json({ message: 'Entry not found' });
        }

        const entry = tempData[entryIndex];

        // Read data.json
        let data = [];
        try {
            data = await readJsonFile(dataPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }

        // Add the entry to data.json
        data.push(entry);
        await writeJsonFile(dataPath, data);

        // Remove the entry from tempdata.json
        tempData.splice(entryIndex, 1);
        await writeJsonFile(tempDataPath, tempData);

        res.json({ message: 'Entry moved successfully' });
    } catch (error) {
        console.error('Error moving entry:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});




app.get("/property/:id", (req, res) => {
    res.sendFile(__dirname + '/details.html'); // Serve the details page
});

// Function to get the local IP address
function getLocalIP() {
    const networkInterfaces = os.networkInterfaces();
    let localIP = '';
    for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
        if (localIP) break;
    }
    return localIP;
}

// Start server
app.listen(PORT, () => {
    console.log(`Hosting on `+ getLocalIP() + `:${PORT}`);
    console.log(`Server running on http://localhost:${PORT}`);
});