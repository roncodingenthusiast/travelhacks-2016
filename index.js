var express = require('express');
var app = express();
var config = require('./config.json');
var bodyParser = require('body-parser');
var request = require('request');
var apiai = require('apiai');
var mongoose = require('mongoose');
var message = require('./messaging');
var controller = require('./controller.js');

app.set('port', (process.env.PORT || 5000));

app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
 
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

var ai = apiai('fb2c9b42a72f491783ff189925dd909f');

var profile = {
    id: 0,
    user: '',
    phone: 0
}


// Home Page
app.get('/', function(req, res) {
    res.sendFile(__dirname + '/views/pages/landing-page/landing.html');
});

app.get('/guide-signup', function (req, res) {
    res.sendFile(__dirname + '/views/pages/guide-signup.html');
});

// Let's facebook verify our app
app.get('/webhook', function(req, res) {
    if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.webhook_token) {
        console.log("Validating webhook");
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);          
    }  
});

app.post('/aihook', function (req, res) {
    var result = req.body.result;
    switch (result.action) {
        case 'findTourGuide':
            console.log('findTourGuide');
            console.log(profile);
            result.paramaters.name = profile.user;
            controller.Guide.find({city: result.parameters['geo-city']}, function (err, users) {
                console.log(users);
                res.json({});
            });
            break;
        case 'addTourGuide':
            console.log('addTourGuide');
            console.log(result)
            if (!result.actionIncomplete) {
                console.log('Adding new guide: ' + profile.user);
                var newGuide = new controller.Guide({
                    city: result.parameters.city, 
                    name: profile.name,
                    phone: result.parameters.phone-number,
                    guideId: profile.id
                });
                newGuide.save(function (err, guide) {
                    console.log(guide);
                    if (!err) {
                        result.fulfillment.speech = 'You are now a travel guide in ' + result.parameters.city + '!'
                        res.json(result.fulfillment);
                    }
                });
            }
            break;
        
        default:
            console.log('no handler foudn');
            
    }

});

// Main message processing
app.post('/webhook', function(req, res) {
    var data = req.body;

    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function(pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function(messagingEvent) {
                if (messagingEvent.optin) {

                    // User Authenticated to our bot
                    console.log("Recieved Auth: " + JSON.stringify(messagingEvent));

                } else if (messagingEvent.message) {

                    // Recieved a message 
                    //console.log("Recieved Message: " + JSON.stringify(messagingEvent));
                    profile.id = messagingEvent.sender.id;
                    getProfile(profile.id, function (p) {
                        profile.user = p.first_name;
                    });
                    message = messagingEvent.message.text;
                    atts = messagingEvent.attachments;

                    var ai_req = ai.textRequest(message); 
                    console.log(ai_req);

                    ai_req.on('response', function(response) {
                        console.log(response);
                        respmsg = response.result.fulfillment.speech;
                        if (respmsg.indexOf('$name') > -1) {
                            respmsg = respmsg.replace('$name', profile.user);
                        }
                        send(profile.id, respmsg)
                    });

                    ai_req.on('error', function(error) {
                        console.log(error + "Ai error");
                    });

                    ai_req.end();
                                        
                } else if (messagingEvent.delivery) {
                    // Message sent successfully
                    console.log("Recieved Delivery: " + JSON.stringify(messagingEvent));

                } else if (messagingEvent.postback) {

                    // User clicked a button on a formatted message
                    console.log("Recieved Postback: " + JSON.stringify(messagingEvent));
                
                } else {
                    // some error
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        //
        // You must send back a 200, within 20 seconds, to let us know you've 
        // successfully received the callback. Otherwise, the request will time out.
        res.sendStatus(200);
    }
});


function getProfile(id, callback) {
    var ret;
    request.get({
        uri: 'https://graph.facebook.com/v2.6/' + id,
        qs: {
            fields: 'first_name, last_name, locale, timezone, gender',
            access_token: process.env.page_token,
        }
    }, function (err, resp, profile) {
        callback(JSON.parse(profile));
    });
}

function send(recipientId, messageText) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: messageText
		}
	};

    console.log('Calling send api');
	callSendAPI(messageData);
}

function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: { access_token: process.env.page_token },
        method: 'POST',
        json: messageData

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            console.log("Successfully sent generic message with id %s to recipient %s", 
            messageId, recipientId);
        } else {
            console.error("Unable to send message.");
            console.error(response);
            console.error(error);
        }
    });  
}

app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});


