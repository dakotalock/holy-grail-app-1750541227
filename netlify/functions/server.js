// File: netlify/functions/message.js

// 1. Core Module Imports
const express = require('express');
const serverless = require('serverless-http'); // Essential for running Express on serverless platforms
const sqlite3 = require('sqlite3').verbose(); // SQLite3 driver
const path = require('path');
const fs = require('fs'); // For file system operations, like checking if DB file exists

// 2. Initialize Express Application
const app = express();
app.use(express.json()); // Middleware to parse JSON request bodies

// 3. Configure CORS (Cross-Origin Resource Sharing)
// This is crucial for allowing your frontend (e.g., running on localhost:3000)
// to make requests to your backend function (which will have a different origin).
const cors = require('cors');
app.use(cors()); // For development simplicity, allow all origins.
// In a production environment, you would restrict this to your frontend's domain:
// app.use(cors({ origin: 'https://your-frontend-domain.com' }));

// 4. Database Setup and Initialization
// IMPORTANT NOTE ON SQLite PERSISTENCE IN NETLIFY FUNCTIONS:
// Netlify Functions (and other serverless platforms) provide an ephemeral filesystem.
// This means any files written to the disk (like our SQLite database file)
// will *not* persist across different invocations of the function, and can be
// cleared between requests if the underlying container is spun down or recycled.
//
// For this "Simple Persistent Message" demonstration, we are creating the SQLite
// database file in the `/tmp` directory, which is writable but not persistent.
// This allows the code to *demonstrate* SQLite operations, but the "persistence"
// will be limited to the lifespan of a single function invocation/container.
// If true, global persistence is required, an external database service (e.g.,
// FaunaDB, Supabase, a hosted PostgreSQL, MongoDB Atlas) should be used instead.
const DB_PATH = path.join('/tmp', 'message.db'); // Use /tmp for writable storage in serverless environments

let db; // Global variable to hold the database connection object

/**
 * Initializes the SQLite database: connects, creates table if not exists,
 * and inserts a default message if the table is empty.
 * @returns {Promise<void>} A promise that resolves when the database is initialized.
 */
async function initializeDb() {
    return new Promise((resolve, reject) => {
        // Check if the database file exists. This helps in logging and initial setup logic.
        const dbExists = fs.existsSync(DB_PATH);

        // Connect to the SQLite database. If the file doesn't exist, it will be created.
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                return reject(new Error(`Failed to open database: ${err.message}`));
            }
            console.log(`Connected to the SQLite database at: ${DB_PATH}`);

            // Create the 'messages' table if it doesn't already exist.
            db.run(`CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                content TEXT NOT NULL
            )`, (err) => {
                if (err) {
                    console.error('Error creating messages table:', err.message);
                    return reject(new Error(`Failed to create table: ${err.message}`));
                }
                console.log('Messages table checked/created.');

                // Insert a default message if the table is empty.
                // This ensures there's always a message to display initially.
                db.get("SELECT COUNT(*) as count FROM messages", (err, row) => {
                    if (err) {
                        console.error('Error checking message count:', err.message);
                        return reject(new Error(`Failed to check message count: ${err.message}`));
                    }
                    if (row.count === 0) {
                        db.run(`INSERT INTO messages (id, content) VALUES (?, ?)`, [1, "Hello Full Stack World!"], (err) => {
                            if (err) {
                                console.error('Error inserting default message:', err.message);
                                return reject(new Error(`Failed to insert default message: ${err.message}`));
                            }
                            console.log('Default message "Hello Full Stack World!" inserted.');
                            resolve(); // Resolve the promise once initialization is complete
                        });
                    } else {
                        console.log('Messages table already contains data. No default message inserted.');
                        resolve(); // Resolve if data already exists
                    }
                });
            });
        });
    });
}

// Kick off the database initialization process immediately when the function loads.
// This promise will be awaited in the main handler to ensure the DB is ready before requests are processed.
const dbInitializationPromise = initializeDb();

// 5. API Endpoints Specification

/**
 * Endpoint 1: Get Message
 * URL: /api/message
 * Method: GET
 * Description: Retrieves the current persistent message from the database.
 */
app.get('/api/message', async (req, res) => {
    try {
        // Ensure the database is initialized before attempting to query.
        await dbInitializationPromise;

        // Fetch the message with ID 1 (our single persistent message).
        db.get("SELECT content FROM messages WHERE id = 1", (err, row) => {
            if (err) {
                console.error('Database error fetching message:', err.message);
                // Return a 500 Internal Server Error if a database error occurs.
                return res.status(500).json({
                    error: "Failed to retrieve message",
                    details: err.message
                });
            }
            if (row) {
                // If a message is found, return it with a 200 OK status.
                res.status(200).json({
                    message: row.content
                });
            } else {
                // This case should ideally not happen if the default message is inserted correctly.
                // It indicates the expected message row is missing.
                res.status(404).json({
                    error: "Message not found",
                    details: "No message found with ID 1. Database might be uninitialized or corrupted."
                });
            }
        });
    } catch (error) {
        // Catch any errors during the async operations (e.g., dbInitializationPromise rejection).
        console.error('Server error on GET /api/message:', error);
        res.status(500).json({
            error: "Failed to retrieve message",
            details: error.message
        });
    }
});

/**
 * Endpoint 2: Update Message
 * URL: /api/message
 * Method: POST
 * Description: Updates the persistent message in the database.
 * Request Body: { "newMessage": "New message content to save" }
 */
app.post('/api/message', async (req, res) => {
    try {
        // Ensure the database is initialized before attempting to update.
        await dbInitializationPromise;

        const {
            newMessage
        } = req.body;

        // Basic input validation: check if newMessage is a non-empty string.
        if (typeof newMessage !== 'string' || newMessage.trim().length === 0) {
            // Return a 400 Bad Request if the input is invalid.
            return res.status(400).json({
                error: "Bad Request",
                details: "newMessage is required and must be a non-empty string."
            });
        }

        // Use INSERT OR REPLACE to handle updates and initial inserts for ID 1.
        // If a row with id=1 exists, it will be updated. If not, it will be inserted.
        db.run(`INSERT OR REPLACE INTO messages (id, content) VALUES (?, ?)`, [1, newMessage.trim()], function(err) {
            if (err) {
                console.error('Database error updating message:', err.message);
                // Return a 500 Internal Server Error if a database error occurs during update.
                return res.status(500).json({
                    error: "Failed to update message",
                    details: err.message
                });
            }
            console.log(`Message with ID 1 updated successfully.`);
            // Return a 200 OK success response with the updated message.
            res.status(200).json({
                status: "success",
                message: "Message updated successfully",
                updatedMessage: newMessage.trim()
            });
        });
    } catch (error) {
        // Catch any errors during the async operations (e.g., dbInitializationPromise rejection).
        console.error('Server error on POST /api/message:', error);
        res.status(500).json({
            error: "Failed to update message",
            details: error.message
        });
    }
});

// 6. Netlify Functions Handler Export
// The `serverless-http` package wraps our Express app, making it compatible
// with the Netlify Functions (AWS Lambda) event and context structure.
const handler = serverless(app);

// Export the handler function. Netlify will look for this `handler` export.
module.exports.handler = async (event, context) => {
    // Ensure the database initialization promise has resolved before handling the request.
    // This is critical for "cold starts" where the function container is spun up for the first time
    // and `initializeDb` might still be in progress.
    await dbInitializationPromise;

    // Pass the event and context to the wrapped Express app.
    return handler(event, context);
};