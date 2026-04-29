// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD_hfvqE7aungNRLzNZpQzARLkwQML7dGo",
  authDomain: "realtimeplanners-appv3.firebaseapp.com",
  projectId: "realtimeplanners-appv3",
  storageBucket: "realtimeplanners-appv3.firebasestorage.app",
  messagingSenderId: "61594828338",
  appId: "1:61594828338:web:a1837ce15f7c30aa0d462b",
  measurementId: "G-0GWY4PDN7M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
