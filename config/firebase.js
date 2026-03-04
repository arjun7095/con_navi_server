const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

admin.messaging().send({
  token: "ekeCbTJASGa0KQ1W7kMvVd:APA91bFZ6uFo0Oo_KGpwNEatDEbhNrbG_20hemvuYEMGwjB4cOZsDEcOVPsTCyO65oS8vj1kPJOPtGKnaGXQt-ZxlxEgsQ9aLLdf7qq_8RytJZrj3t-n0PM",
  notification: {
    title: "Test",
    body: "Working"
  }
})
.then(console.log)
.catch(console.error);