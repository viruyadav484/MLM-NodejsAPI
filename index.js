const OrientDBClient = require("orientjs").OrientDBClient;

// async function connectDB() {
//     const client = await OrientDBClient.connect({
//         host: "localhost",
//         port: 2424
//     });

//     const session = await client.session({
//         name: "demodb",  // Change this to your database name
//         username: "root",
//         password: "Viru@7862"
//     });

//     console.log("Connected to OrientDB!");

//     await session.close();
//     await client.close();
// }

// connectDB().catch(console.error);

// async function createDatabase() {
//     const client = await OrientDBClient.connect({
//         host: "localhost",
//         port: 2424
//     });

//     const exists = await client.existsDatabase({
//         name: "demodb",
//         username: "root",
//         password: "Viru@7862"
//     });

//     if (!exists) {
//         await client.createDatabase({
//             name: "demodb",
//             type: "graph",
//             storage: "plocal",
//             username: "root",
//             password: "Viru@7862"
//         });

//         console.log("Database created successfully!");
//     } else {
//         console.log("Database already exists.");
//     }

//     await client.close();
// }

// createDatabase().catch(console.error);

