var Mailgun = require('mailgun-js')({domain: 'www.knitchartsapp.com', apiKey: 'key-75b941cb44c2404919a721429f1af38c'});


function generateRestorationCode() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for( var i=0; i < 10; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

function generateRestorationCodeForUser(userObject, resetObject, response) {
    resetObject.set("user", userObject);
    resetObject.set("restorationCode", generateRestorationCode());

    resetObject.save(null, {
      success: function(reset) {
        // Execute any logic that should take place after the object is saved.
        sendPasswordResetMail(userObject.get("email"), userObject.get("username"), resetObject.get("restorationCode"));
        response.success();
      },
      error: function(reset, error) {
        // Execute any logic that should take place if the save fails.
        // error is a Parse.Error with an error code and message.
        response.error('Failed to create new resetObject, with error code: ' + error.message);
      },
        useMasterKey: true
    });
}

function sendPasswordResetMail(email, username, restorationCode) {
    var data = {
      to: email,
      from: "KnitCharts <support@knitchartsapp.com>",
      subject: "Reset KnitCharts password",
      text: "Hello " + username + ",\n\n To reset your password please open this link on your device: knitcharts://restorePassword/" + restorationCode 
    };

    Mailgun.messages().send(data, function (error, body) {
        console.log(body);
    });
}


Parse.Cloud.define("requestResetPassword", function(request, response) {
    var userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo('email', request.params.email);
    userQuery.first({
                success: function(userObject) {
                    if (userObject !== undefined) {
                        // check if reset was already requested
                        var resetQuery = new Parse.Query("KCPasswordReset");
                        resetQuery.equalTo('user', userObject);
                        resetQuery.first({
                                    success: function(resetObject) {
                                        if (resetObject !== undefined) {
                                            generateRestorationCodeForUser(userObject, resetObject, response);
                                        } else {
                                            var KCPasswordReset = Parse.Object.extend("KCPasswordReset");
                                            var passwordReset = new KCPasswordReset();

                                            generateRestorationCodeForUser(userObject, passwordReset, response);
                                        }
                                    },
                                    error: function(error) {
                                        console.error("Error: " + error.code + " " + error.message);
                                        response.error('Failed to search reset objects ' + error.message);
                                    },
                                    useMasterKey: true
                                });
                    } else {
                        response.error('A user with this email does not exist ' + error.message);
                    }
                },
                error: function(error) {
                    response.error('Failed to search user objects ' + error.message);
                },
                useMasterKey: true
            });
});

Parse.Cloud.define("resetPassword", function(request, response) {
    var resetQuery = new Parse.Query("KCPasswordReset");
    resetQuery.equalTo('restorationCode', request.params.restorationCode);
    resetQuery.first({
                success: function(resetObject) {
                    if (resetObject !== undefined) {
                        var userObject = resetObject.get("user");
                        userObject.set("password", request.params.password);
                        userObject.save(null, {
                          success: function(userObject) {
                            userObject.fetch({
                              success: function(userObject) {
                                resetObject.destroy({
                                  success: function(myObject) {
                                    console.log("changed password for user " + userObject.get("username") + "lkasjlfdsjkfd" + userObject);
                                    response.success(userObject.get("username"));
                                  },
                                  error: function(myObject, error) {
                                    response.error('Could not delete resetObject ' + error.message);
                                  },
                                  useMasterKey: true
                                });
                              },
                              error: function(myObject, error) {
                                    response.error('Could not refresh user ' + error.message);
                              },
                              useMasterKey: true
                            });
                            
                          },
                          error: function(userObject, error) {
                            response.error('Could not save password for user ' + error.message);
                          },
                          useMasterKey: true
                        });
                    } else {
                        response.error('The restorationCode does not exist');
                    }
                },
                error: function(error) {
                    response.error('Failed to search reset objects' + error.message);
                },
                useMasterKey: true
            });
});

Parse.Cloud.define("trendingSearches", function(request, response) {
    var searchTermsCountMapping = {};
    var searchQuery = new Parse.Query("KCSearch");
    searchQuery.each(function(result) {
        var searchTerm = result.get("term");
        if (searchTerm in searchTermsCountMapping) {
            searchTermsCountMapping[searchTerm] += 1;
        } else {
            searchTermsCountMapping[searchTerm] = 1;
        }
    }, {
        success: function() {
            var sortedTerms = Object.keys(searchTermsCountMapping).sort(function(a, b) {
                return searchTermsCountMapping[b] - searchTermsCountMapping[a]
            });
            sortedTerms = sortedTerms.slice(0, 8);
            response.success(sortedTerms);
        },
        error: function(error) {
            // error is an instance of Parse.Error.
        }
    });
});

Parse.Cloud.afterSave("KCChartComment", function(request) {
    if (!request.object.existed()) {
        query = new Parse.Query("KCChart");
        query.get(request.object.get("chart").id, {
            success: function(chart) {
                chart.increment("commentsCount");
                chart.save();

                if (chart.get("author").id === request.object.get("author").id) {
                    return;
                }
                var userQuery = new Parse.Query(Parse.User);
                userQuery.get(chart.get("author").id, {
                    success: function(author) {
                        if (author.get("receiveChartCommentsNotifications")) {
                            var query = new Parse.Query(Parse.Installation);
                            query.equalTo('user', chart.get("author"));
                            Parse.Push.send({
                                where: query, // Set our Installation query
                                data: {
                                    alert: "Someone commented on your chart.",
                                    chartUUID: chart.get("uuid")
                                }
                            }, {
                                success: function() {
                                    // Push was successful
                                },
                                error: function(error) {
                                    // Handle error
                                    console.error(error.message);
                                }
                            });
                        }
                    },
                    error: function(error) {
                        console.error("Got an error trying to fetch author of the chart");
                    }
                });
            },
            error: function(error) {
                console.error("Got an error " + error.code + " : " + error.message);
            }
        });
    }
});

Parse.Cloud.afterDelete("KCChartComment", function(request) {
    query = new Parse.Query("KCChart");
    query.get(request.object.get("chart").id, {
        success: function(post) {
            post.increment("commentsCount", -1);
            post.save();
        },
        error: function(error) {
            console.error("Got an error trying to decrement comments count for chart with id " + request.object.get("chart").objectId + " with error code " + error.code + " : " + error.message);
        }
    });
});

Parse.Cloud.afterSave("KCDownload", function(request) {
    query = new Parse.Query("KCChart");
    query.get(request.object.get("chart").id, {
        success: function(post) {
            post.increment("downloads");
            post.save();
        },
        error: function(error) {
            console.error("Got an error trying to increment downloads count for chart with id " + request.object.get("chartObjectId") + " with error code " + error.code + " : " + error.message);
        }
    });
});

Parse.Cloud.afterDelete("KCDownload", function(request) {
    query = new Parse.Query("KCChart");
    query.get(request.object.get("chart").id, {
        success: function(post) {
            post.increment("downloads", -1);
            post.save();
        },
        error: function(error) {
            console.error("Got an error trying to decrement downloads count for chart with id " + request.object.get("chartObjectId") + " with error code " + error.code + " : " + error.message);
        }
    });
});

Parse.Cloud.beforeSave("KCChart", function(request, response) {
    if (!request.object.isNew()) {
        var query = new Parse.Query("KCChart");
        query.get(request.object.id, {
            success: function(chart) {
                if (chart.get('author').objectId !== request.object.get("author").objectId) {
                    response.error('Trying to change author');
                } else {
                    var originalTags = chart.get("tags");
                    var editedTags = request.object.get("tags");
                    var uniqueTags = []; 
                    for (var i = 0; i < editedTags.length; i++) {
                        if (uniqueTags.indexOf(editedTags[i]) == -1) uniqueTags.push(editedTags[i]);
                    }
                    editedTags = uniqueTags;

                    var addedTags = [];
                    var removedTags = [];

                    editedTags.forEach(function(tag) {
                        if (originalTags.indexOf(tag) == -1) { // not found
                            addedTags.push(tag);
                        }
                    });
                    request.object.set("addedTagsAfterEditing", addedTags);
                    originalTags.forEach(function(tag) {
                        if (editedTags.indexOf(tag) == -1) { // not found
                            removedTags.push(tag);
                        }
                    });
                    request.object.set("removedTagsAfterEditing", removedTags);
                    response.success();
                }
            },
            error: function(row, error) {
                response.error(error.message);
            }
        });
    } else {
        if (!request.object.get("title") || !request.object.get("uuid") || !request.object.get("author")) {
            response.error("missing attributes");
        } else {
            if (request.user.email === undefined || request.user.email === null) {
                response.error("Unauthorized access");
            } else {
                request.object.set("addedTagsAfterEditing", request.object.get("tags"));
                response.success();
            }
        }
    }
});

Parse.Cloud.afterSave("KCChart", function(request) {
    var addedTags = request.object.get("addedTagsAfterEditing");
    if (addedTags !== undefined && addedTags.length > 0) {
        addedTags.forEach(function(entry) {
            query = new Parse.Query("KCTag");
            var KCTag = Parse.Object.extend("KCTag");
            var query = new Parse.Query(KCTag);
            query.equalTo("title", entry);
            query.first({
                success: function(tagObject) {
                    console.log('tagObject:' + tagObject);
                    if (tagObject !== undefined) {
                        var relation = tagObject.relation("charts");
                        relation.add(request.object);
                        tagObject.increment("usageCount");
                        tagObject.save();
                    } else {
                        var KCTag = Parse.Object.extend("KCTag");
                        var tag = new KCTag();

                        tag.set("title", entry);
                        tag.set("lowercaseTitle", entry.toLowerCase());
                        tag.set("usageCount", 1);
                        var relation = tag.relation("charts");
                        relation.add(request.object);

                        tag.save();
                    }
                },
                error: function(error) {
                    alert("Error: " + error.code + " " + error.message);
                }
            });
        });
    }

    var removedTags = request.object.get("removedTagsAfterEditing");
    if (removedTags !== undefined && removedTags.length > 0) {
        removedTags.forEach(function(entry) {
            query = new Parse.Query("KCTag");
            var KCTag = Parse.Object.extend("KCTag");
            var query = new Parse.Query(KCTag);
            query.equalTo("title", entry);
            query.first({
                success: function(tagObject) {
                    if (tagObject !== undefined) {
                        var relation = tagObject.relation("charts");
                        relation.remove(request.object);
                        tagObject.increment("usageCount", -1);
                        tagObject.save();
                    }
                },
                error: function(error) {
                    alert("Error: " + error.code + " " + error.message);
                }
            });
        });
    }
    
});

Parse.Cloud.beforeDelete("KCChart", function(request, response) {
    if (request.user.objectId !== request.object.get("author").objectId) {
        response.error("Unauthorized access");
    } else {
        response.success();
    }
});

Parse.Cloud.afterDelete("KCChart", function(request) {
    reportsQuery = new Parse.Query("KCReport");
    reportsQuery.equalTo("chart", request.object);
    reportsQuery.find({
        success: function(reports) {
            Parse.Object.destroyAll(reports, {
                success: function() {},
                error: function(error) {
                    console.error("Error deleting related reports " + error.code + ": " + error.message);
                },
                useMasterKey: true
            });
        },
        error: function(error) {
            console.error("Error finding related reports " + error.code + ": " + error.message);
        }
    });
    downloadsQuery = new Parse.Query("KCDownload");
    downloadsQuery.equalTo("chart", request.object);
    downloadsQuery.find({
        success: function(downloads) {
            Parse.Object.destroyAll(downloads, {
                success: function() {},
                error: function(error) {
                    console.error("Error deleting related downloads " + error.code + ": " + error.message);
                },
                useMasterKey: true
            });
        },
        error: function(error) {
            console.error("Error finding related downloads " + error.code + ": " + error.message);
        }
    });

    commentsQuery = new Parse.Query("KCChartComment");
    commentsQuery.equalTo("chart", request.object);
    commentsQuery.find({
        success: function(comments) {
            Parse.Object.destroyAll(comments, {
                success: function() {},
                error: function(error) {
                    console.error("Error deleting related comments " + error.code + ": " + error.message);
                },
                useMasterKey: true
            });
        },
        error: function(error) {
            console.error("Error finding related comments " + error.code + ": " + error.message);
        }
    });

    var Tag = Parse.Object.extend("KCTag");
    var Chart = Parse.Object.extend("KCChart");
    var innerQuery = new Parse.Query(Chart);
    innerQuery.equalTo("objectId", request.objectId);
    var query = new Parse.Query(Tag);
    query.containedIn("charts", [request.object]);
    query.find({
        success: function(tags) {
            console.log('tags' + tags);
            if (tags !== undefined && tags.length > 0) {
                tags.forEach(function(tagObject) {
                    var relation = tagObject.relation("charts");
                    relation.remove(request.object);
                    tagObject.increment("usageCount", -1);
                    tagObject.save();
                });
            }
        },
        error: function(error) {
            console.error("Error finding tags " + error.code + ": " + error.message);
        }
    });
});