import firebase_admin
from firebase_admin import credentials
from firebase_admin import messaging

# Path to your downloaded service account JSON key
cred = credentials.Certificate("serviceAccountKey.json")  # ← change if different name/path

# Initialize (this step already tests basic key validity)
firebase_admin.initialize_app(cred)

# Replace with a REAL device token from your app
# (Get it by logging FirebaseMessaging.getInstance().getToken() on Android / getToken() on web/iOS)
registration_token = "cgwg-NNxTqOVc5nNuJpQqz:APA91bFar7SWTg3S2XG75gwFzQ2TOBCrDlNMt9jKfFJNbKEN7ZbaWAKKu1qxrZ8zQU2peg4JRPyXLiZG2hILz3kur3EKTQrjyP9ysrtj35aRiJbUbHhkg54"

# Build a test notification message
message = messaging.Message(
    notification=messaging.Notification(
        title="Test from Service Account Key",
        body="If you see this → your key WORKS! 🎉"
    ),
    token=registration_token,  # or use topic='test-topic' if subscribed
)

# Send it!
try:
    response = messaging.send(message)
    print("Successfully sent message:", response)
except Exception as e:
    print("Error sending message:", e)