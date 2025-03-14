// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { URLSearchParams } = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;

// Replace with your actual Cloudflare credentials
const CLOUDFLARE_APP_ID = '9eb4e5f9905845ff1bfaf39ad5fdf622';
const CLOUDFLARE_API_TOKEN = '8868573252ae977abc3fbbc421f8ae2c41b2c880ce38e988e367f8f10afeb9d4';

// Middleware to parse JSON request bodies
app.use(express.json());

const clients = {}; // Store connected clients
const clientSessionMap = new Map(); // Map client IDs to session IDs

function generateClientId() {
    return Math.random().toString(36).substring(2, 15);
}

wss.on('connection', ws => {
    const clientId = generateClientId();
    clients[clientId] = { ws: ws, sessionId: null, remoteClientId:null }; // Store WebSocket connection
    console.log(`Client ${clientId} connected`);
    // Send the client its ID and the list of other clients
    ws.send(JSON.stringify({ type: 'clientId', clientId: clientId, otherClientIds: Object.keys(clients) }));

    ws.on('message', async message => {
        try {
            const parsedMessage = JSON.parse(message);
            console.log(`Signaling Server Received from Client ${clientId}:`, parsedMessage);

            // Declare targetClientId and targetClient outside the switch statement
            let targetClientId;
            let targetClient;

            switch (parsedMessage.type) {
                case 'createSession':
                    console.log(`Signaling Server: Received createSession request from Client ${clientId}`);
                    try {
                        const apiUrl = `https://rtc.live.cloudflare.com/v1/apps/${CLOUDFLARE_APP_ID}/sessions/new`;
                        const headers = {
                            'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                            'Content-Type': 'application/json',
                        };
                        const queryParams = new URLSearchParams();
                        if (parsedMessage.thirdparty !== undefined) {
                            queryParams.append('thirdparty', parsedMessage.thirdparty);
                        }
                        const fullApiUrl = queryParams.toString() ? `${apiUrl}?${queryParams.toString()}` : apiUrl;
                        const requestInfo = {
                            apiUrl: fullApiUrl,
                            headers: headers,
                        };
                        console.log(`Signaling Server: [2] Rest API sent from Signaling Server to Cloudflare:`, requestInfo);

                        const response = await fetch(fullApiUrl, {
                            method: 'POST',
                            headers: headers,
                        });

                        console.log(`Signaling Server: Cloudflare API Response Status - ${response.status}`);

                        if (!response.ok) {
                            const errorBody = await response.text();
                            console.error(`Signaling Server: Cloudflare API Error - ${response.status} - ${errorBody}`);
                            ws.send(JSON.stringify({ type: 'createSessionResponse', success: false, error: `Cloudflare API Error: ${response.status} - ${errorBody}` }));
                            return;
                        }

                        const data = await response.json();
                        console.log(`Signaling Server: [3] Response from Cloudflare to Signaling Server after creating session:`, data);

                        if (data && data.sessionId) {
                            const sessionId = data.sessionId; // Get the sessionId from the response
                            clientSessionMap.set(clientId, sessionId); // Store session ID for the client
                            clients[clientId].sessionId = sessionId;
                            console.log(`Signaling Server: Session created with ID ${sessionId} for client ${clientId}`);
                            ws.send(JSON.stringify({ type: 'createSessionResponse', success: true, sessionId: sessionId }));
                            console.log(`Signaling Server: Sent createSessionResponse to Client ${clientId} with sessionId ${sessionId}`);
                        } else {
                            console.error('Signaling Server: Invalid session ID received from Cloudflare.');
                            ws.send(JSON.stringify({ type: 'createSessionResponse', success: false, error: 'Invalid session ID from Cloudflare' }));
                        }
                    } catch (error) {
                        console.error('Signaling Server: Error calling Cloudflare API:', error);
                        ws.send(JSON.stringify({ type: 'createSessionResponse', success: false, error: error.message }));
                    }
                    break;
                case 'createTracks':
                    const sessionId = clientSessionMap.get(clientId); // Retrieve session ID from the map
                    if (!sessionId) {
                        console.error('Signaling Server: Session ID is missing. Create a session first.');
                        ws.send(JSON.stringify({ type: 'createTracksResponse', success: false, error: 'Session ID is missing. Create a session first.' }));
                        return;
                    }
                    console.log(`Signaling Server: Received createTracks request from Client ${clientId} for session ${sessionId}`);
                    try {
                        const apiUrl = `https://rtc.live.cloudflare.com/v1/apps/${CLOUDFLARE_APP_ID}/sessions/${sessionId}/tracks/new`;
                        const headers = {
                            'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                            'Content-Type': 'application/json',
                        };
                        const sdp = parsedMessage.sdp;
                        const requestBody = {
                            sessionDescription: {
                                sdp: sdp,
                                type: 'offer'
                            },
                            tracks: [
                                {
                                    location: 'local',
                                    mid: '0', // You can adjust the MID as needed
                                    trackName: 'audio-track',  // You can generate a unique name
                                    kind: "audio"
                                },
                                {
                                    location: 'local',
                                    mid: '1', // You can adjust the MID as needed
                                    trackName: 'video-track',  // You can generate a unique name
                                    kind: "video"
                                }
                            ]
                        };
                        const requestInfo = {
                            apiUrl: apiUrl,
                            headers: headers,
                            payload: requestBody,
                            sdp: sdp,
                        };
                        console.log(`Signaling Server: [7] Rest API Sent with payloads and headers in the format of json from signaling server to Cloudflare:`,requestInfo);

                        const response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify(requestBody),
                        });

                        console.log(`Signaling Server: Cloudflare API Response Status - ${response.status}`);

                        if (!response.ok) {
                            const errorBody = await response.text();
                            console.error(`Signaling Server: Cloudflare API Error - ${response.status} - ${errorBody}`);
                            ws.send(JSON.stringify({ type: 'createTracksResponse', success: false, error: `Cloudflare API Error: ${response.status} - ${errorBody}` }));
                            return;
                        }

                        const data = await response.json();
                        console.log(`Signaling Server: [8] Answers and responses from Cloudflare to signaling server in the json format:`, data);

                        ws.send(JSON.stringify({ type: 'createTracksResponse', success: true, data: data }));
                        console.log(`Signaling Server: Sent createTracksResponse to Client ${clientId}`);
                    } catch (error) {
                        console.error('Signaling Server: Error calling Cloudflare API:', error);
                        ws.send(JSON.stringify({ type: 'createTracksResponse', success: false, error: error.message }));
                    }
                    break;
                  case 'iceCandidate': //handle the ice candidate
                    console.log(`Signaling Server: Received ICE candidate from Client ${clientId}`);
                     // Find the target client (the other peer)
                     targetClientId = parsedMessage.targetClientId;
                     targetClient = clients[targetClientId];
                     if (targetClient) {
                         // Forward the ICE candidate to the target client
                         targetClient.ws.send(JSON.stringify({
                             type: 'iceCandidate',
                             candidate: parsedMessage.candidate,
                             clientId: clientId // Include the source client ID
                         }));
                         console.log(`Signaling Server: Forwarded ICE candidate from ${clientId} to ${targetClientId}`);
                     } else {
                         console.error(`Signaling Server: Target client ${targetClientId} not found.`);
                     }
                    break;

                case 'sdpOffer': //handle the sdp offer
                    console.log(`Signaling Server: Received SDP offer from Client ${clientId}`);

                     // Find the target client (the other peer)
                     targetClientId = parsedMessage.targetClientId;
                     targetClient = clients[targetClientId];

                     if (targetClient) {
                         // Forward the SDP offer to the target client
                         targetClient.ws.send(JSON.stringify({
                             type: 'sdpOffer',
                             sdp: parsedMessage.sdp,
                             clientId: clientId // Include the source client ID
                         }));
                         console.log(`Signaling Server: Forwarded SDP offer from ${clientId} to ${targetClientId}`);
                     } else {
                         console.error(`Signaling Server: Target client ${targetClientId} not found.`);
                     }
                     break;

                 case 'sdpAnswer'://handle the sdp answer
                     console.log(`Signaling Server: Received SDP answer from Client ${clientId}`);

                     // Find the target client (the client that sent the offer)
                     targetClientId = parsedMessage.targetClientId;
                     targetClient = clients[targetClientId];

                     if (targetClient) {
                         // Forward the SDP answer to the target client
                         targetClient.ws.send(JSON.stringify({
                             type: 'sdpAnswer',
                             sdp: parsedMessage.sdp,
                             clientId: clientId // Include the source client ID
                         }));
                         console.log(`Signaling Server: Forwarded SDP answer from ${clientId} to ${targetClientId}`);
                     } else {
                         console.error(`Signaling Server: Target client ${targetClientId} not found.`);
                     }
                     break;

                default:
                    console.log(`Signaling Server: Unknown message type received from Client ${clientId}: ${parsedMessage.type}`);
            }
        } catch (error) {
            console.error('Signaling Server: Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Client ${clientId} disconnected`);
        clientSessionMap.delete(clientId); // Remove session ID from map
        delete clients[clientId];
    });

    // Send the client its ID
    ws.send(JSON.stringify({ type: 'clientId', clientId: clientId }));
});

server.listen(port, () => {
    console.log(`Signaling server listening at http://localhost:${port}`);
});