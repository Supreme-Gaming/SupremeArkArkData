/*jshint esversion: 6 */
var fs = require('fs');
var parser = require("./parse.js");
var Steam = require('steam-webapi');
var Promise = require('bluebird');
var chunk = require('chunk');
var _ = require('underscore');
var mysql = require('mysql');

const path = require('path');
const settings = JSON.parse(fs.readFileSync('./settings.json', 'utf8'));
const server_settings = settings.server_config;

var connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'password12345',
    database: 'supremeark_arkdata',
    charset: 'utf8mb4'
});

var steamlist = [];
var initialized = false;

function initTable() {
    return new Promise(function (resolve, reject) {
        // if (initialized) {
        //     resolve();
        //     return false;
        // }

        connection.query("DROP TABLE IF EXISTS players");
        connection.query('create table if not exists players (`Id` INTEGER NOT NULL UNIQUE, `TribeId` INT NULL, `TribeName` VARCHAR(255) NULL, `Level` INT NOT NULL, `Engrams` INT NOT NULL, `SteamId` VARCHAR(255) NOT NULL UNIQUE, `Admin` bool NOT NULL DEFAULT false, `CharacterName` VARCHAR(255) NULL,	`SteamName` VARCHAR(255) NULL, `ProfileUrl` VARCHAR(255) NULL, `AvatarUrl` VARCHAR(255) NULL, `CommunityBanned` INT NULL, `VACBanned` INT NULL, `NumberOfVACBans` INT NULL, `NumberOfGameBans` INT NULL, `DaysSinceLastBan` INT NULL, `Banned` bool NOT NULL DEFAULT false, `FileUpdated` DATETIME NULL, `FileCreated` DATETIME NULL, `PlayMap` VARCHAR(255) NULL, `Host` VARCHAR(255) NULL, `DataPort` INT NULL) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci', function (err, res, fields) {
            if (err) {
                console.error("INIT error!", err);
                reject();
            } else {
                initialized = true;
                resolve();
            }
        });
    });



}

function getId(data) {
    return parser.getUInt64('PlayerDataID', data);
}

function getSteamId(data) {
    data = new Buffer(data);
    var type = 'UniqueNetIdRepl';
    var bytes1 = data.indexOf(type);
    if (bytes1 == -1) {
        return false;
    }
    var start = bytes1 + type.length + 9;
    var end = start + 17;
    return data.slice(start, end).toString();
}

function checkId(id, cb) {
    connection.query("SELECT id from players where Id = ?", id, (err, row) => {
        cb(row);
    });
}


function savePlayers(data) {

    return new Promise(function (r, rj) {
        connection.query("BEGIN", function (err) {
            if (err) {
                console.trace("saveplayer error!");
            }
        });

        let reqs = data.map((item) => {
            return new Promise((resolve) => {
                checkId(item.Id, function (d) {
                    // If no item in db, add
                    if (d.length == 0) {
                        connection.query("INSERT INTO `supremeark_arkdata`.`players` (id,steamid,charactername,level,engrams,tribeid,tribename,banned,admin,fileupdated,filecreated,playmap,host,dataport) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [item.Id, item.SteamId, item.CharacterName, item.Level, item.TotalEngramPoints, item.TribeId, item.TribeName, item.Banned, item.Admin, item.FileUpdated, item.FileCreated, item.PlayMap, item.Host, item.DataPort], function (err, sql) {
                            if (err) {
                                connection.query("Delete from players where steamid = ?", item.SteamId);
                                console.log("LINE 96:", err, "\n Will attempt to fix broken cache record...");
                                connection.query("INSERT INTO players (id,steamid,charactername,level,engrams,tribeid,tribename,fileupdated,banned,admin,filecreated,playmap,host,dataport) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [item.Id, item.SteamId, item.CharacterName, item.Level, item.TotalEngramPoints, item.TribeId, item.TribeName, item.Banned, item.Admin, item.FileUpdated, item.FileCreated, item.PlayMap, item.Host, item.DataPort], function (err, sql) {
                                    if (err === undefined || err === null) {
                                        console.log("Cache record fixed successfully!");
                                    } else {
                                        console.log("Failed to fix cache record for steamid: " + item.steamId);
                                    }
                                });

                            }
                        });
                        resolve();
                    } else {
                        resolve();
                    }
                });
            });
        });

        Promise.all(reqs).then(() => {
            connection.query("COMMIT");
            r();
        });
    });

}


function loadSteam(list) {

    return new Promise(function (r, rj) {
        steamAPIKey = server_settings.steam_key;
        Steam.ready(steamAPIKey, Promise.coroutine(function* (err) {
            if (err) {
                return cb(err);
            }
            console.log("Caching Steam Info...");
            valueStrings = [];
            valueArgs = [];
            // Creates an promise wielding function for every method (with Async attached at the end)
            Promise.promisifyAll(Steam.prototype);
            steamlist = chunk(list, 100);
            var steam = new Steam({
                key: steamAPIKey
            });
            let profreqs = steamlist.map((item) => {
                return new Promise((resolve) => {
                    resolve(steam.getPlayerSummariesAsync({
                        steamids: item.toString()
                    }));
                });
            });
            Promise.all(profreqs).then((data) => {
                connection.query("BEGIN", function (err) {
                    if (err) {
                        console.trace("loadsteam error!");
                    }

                });
                linkSteamProfiles(data, function () {
                    console.log("Profiles are done updating!");
                    connection.query("COMMIT");
                    let banreqs = steamlist.map((item) => {
                        return new Promise((resolve) => {
                            resolve(steam.getPlayerBansAsync({
                                steamids: item.toString()
                            }));
                        });
                    });
                    Promise.all(banreqs).then((data) => {
                        connection.query("BEGIN", function (err) {
                            if (err) {
                                console.trace("loadsteam error!");
                            }

                        });
                        linkSteamBans(data, function () {
                            console.log("Steam bans are done updating!");
                            r();
                            connection.query("COMMIT");
                        });
                    }).catch(function (e) {
                        console.log(e);
                        rj('Steam failed to update cache!');
                    });
                });
            }).catch(function (e) {
                console.log(e);
                rj('Steam failed to update cache!');
            });
        }));
    });

}

// Reference Player Summary Response
//
// {
//     steamid: '76561198257402425',
//     communityvisibilitystate: 3,
//     profilestate: 1,
//     personaname: 'EL_LOKO_CUBA',
//     lastlogoff: 1467194055,
//     profileurl: 'http://steamcommunity.com/profiles/76561198257402425/',
//     avatar: 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/7a/7aae8b8bce433f23de6fc16dbd2434316cfe39f1.jpg',
//     avatarmedium: 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/7a/7aae8b8bce433f23de6fc16dbd2434316cfe39f1_medium.jpg',
//     avatarfull: 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/7a/7aae8b8bce433f23de6fc16dbd2434316cfe39f1_full.jpg',
//     personastate: 0,
//     realname: 'EL_LOKO_',
//     primaryclanid: '103582791434995702',
//     timecreated: 1445981532,
//     personastateflags: 0,
//     loccountrycode: 'CU',
//     locstatecode: '11'
// }

// Reference Player Ban Response
//
// {
//     SteamId: '76561198243647060',
//     CommunityBanned: false,
//     VACBanned: false,
//     NumberOfVACBans: 0,
//     DaysSinceLastBan: 0,
//     NumberOfGameBans: 0,
//     EconomyBan: 'none'
// }


function linkSteamProfiles(data, cb) {
    var qry = "Update `supremeark_arkdata`.`players` set SteamName = ?,ProfileUrl = ?,AvatarUrl = ? where SteamId = ?";

    let reqs = data.map((item) => {
        return new Promise((resolves) => {
            let reqss = item.players.map((itemm) => {
                return new Promise((resolve) => {
                    connection.query(qry, [itemm.personaname, itemm.profileurl, itemm.avatarfull, itemm.steamid], (err) => {
                        if (err) {
                            console.log(err);
                            // console.log("Steam profile cache had trouble updating...");
                            return false;
                        }
                        resolve();
                        return true;
                    });
                });
            });
            Promise.all(reqss).then(() => {
                resolves();
            });
        });
    });
    Promise.all(reqs).then(() => {
        cb();
    });
}

function linkSteamBans(data, cb) {
    var qry = "Update `supremeark_arkdata`.`players` set communitybanned = ?,vacbanned = ?,numberofvacbans = ?,numberofgamebans = ?, dayssincelastban = ? where steamid = ?";

    let reqs = data.map((item) => {
        return new Promise((resolves, rejects) => {
            let reqss = item.players.map((subItem) => {
                return new Promise((resolve, reject) => {
                    connection.query(qry, [subItem.CommunityBanned, subItem.VACBanned, subItem.NumberOfVACBans, subItem.NumberOfGameBans, subItem.DaysSinceLastBan, subItem.SteamId], (err) => {
                        if (err) {
                            reject(err);
                            return false;
                        }
                        resolve();
                        return true;
                    });
                });
            });
            Promise.all(reqss).then(() => {
                resolves();
            });
        });
    });
    Promise.all(reqs).then(() => {
        cb();
    });

}

var c = 0;
var qrylist = [];
var readFilePromisified = Promise.promisify(require("fs").readFile);
var readDirPromisified = Promise.promisify(require("fs").readdir);

function setupPlayerFiles() {
    return new Promise(function (resolve, reject) {
        var players = [];
        var playerData = {};
        var banplayers = [];
        steamlist = [];
        qrylist = [];
        var banData;
        var adminData;
        readFilePromisified(path.join(path.normalize(server_settings.ark_path), "ShooterGame", "Binaries", "Linux", "BanList.txt"), "ucs2")
            .then((data) => {
                banData = data;
            })
            .catch((err) => {
                console.log("Doesn't look like bans are in the Linux Folder, going to try the Windows location...");
            })
            .then(() => readFilePromisified(path.join(path.normalize(server_settings.ark_path), "ShooterGame", "Binaries", "Win64", "BanList.txt"), "ucs2"))
            .then((data) => {
                banData = data;
            }).catch((err) => {
                if (banData === undefined) {
                    console.log("No ban file found, not loading server bans...");
                }
            })
            .then(() => readFilePromisified(path.join(path.normalize(server_settings.ark_path), "ShooterGame", "Saved", "AllowedCheaterSteamIDs.txt"), "utf-8"))
            .catch((err) => {
                console.log("No Admins Detected!");
            })
            .then((data) => {
                adminData = data;
            })
            .then(() => readDirPromisified(path.join(path.normalize(path.normalize(server_settings.ark_path)), "ShooterGame", "Saved", server_settings.map_folder_name), "utf-8"))
            .then((files) => {
                if (adminData !== undefined) {
                    var admins = adminData;
                    admins = admins.split("\r\n");
                    if (admins === undefined || admins === "" || admins === null) {
                        admins = admins.split("\n");
                    }
                }
                if (banData !== undefined) {
                    banData = banData.split("\r\n");
                    if (banData === undefined || banData === "" || banData === null) {
                        banData = bans.split("\n");
                    }
                    banData.forEach(function (elem, i) {
                        var a = elem.split(",");
                        if (banData[i] === "") {
                            banData.splice(i);
                            return true;
                        }
                        banplayers.push(a[0]);
                    });
                }
                let reqs = files.map((v) => {
                    var re = new RegExp("^.*\\.arkprofile");
                    if (re.test(v)) {
                        var data = fs.readFileSync(path.join(path.normalize(server_settings.ark_path), "ShooterGame", "Saved", server_settings.map_folder_name, v));
                        playerData = {};
                        playerData.Id = getId(data);
                        playerData.SteamId = getSteamId(data);
                        playerData.PlayerName = parser.getString("PlayerName", data);
                        playerData.Level = parser.getUInt16("CharacterStatusComponent_ExtraCharacterLevel", data) + 1;
                        playerData.TotalEngramPoints = parser.getInt("PlayerState_TotalEngramPoints", data);
                        playerData.CharacterName = parser.getString("PlayerCharacterName", data);

                        if (parser.getInt("TribeID", data) == false) {
                            playerData.TribeId = null;
                        } else {
                            playerData.TribeId = parser.getInt("TribeID", data);
                        }

                        if (playerData.TribeId > 0) {
                            if (fs.existsSync(path.join(path.normalize(server_settings.ark_path), "ShooterGame", "Saved", server_settings.map_folder_name, playerData.TribeId + '.arktribe'))) {
                                var tribeData = fs.readFileSync(path.join(path.normalize(server_settings.ark_path), "ShooterGame", "Saved", server_settings.map_folder_name, playerData.TribeId + '.arktribe'));
                                playerData.TribeName = parser.getString("TribeName", tribeData);
                            } else {
                                playerData.TribeName = 'null';
                            }
                        }
                        var fdata = fs.statSync(path.join(path.normalize(server_settings.ark_path), "ShooterGame", "Saved", server_settings.map_folder_name, v));
                        playerData.FileCreated = new Date(fdata.birthtime);
                        playerData.FileCreated = playerData.FileCreated.toISOString().slice(0, 19).replace('T', ' ');
                        playerData.FileUpdated = new Date(fdata.mtime);
                        playerData.FileUpdated = playerData.FileUpdated.toISOString().slice(0, 19).replace('T', ' ');
                        playerData.Banned = _.indexOf(banplayers, playerData.SteamId) > -1 ? true : false;
                        playerData.Admin = _.indexOf(admins, playerData.SteamId) > -1 ? true : false;
                        playerData.PlayMap = server_settings.map_name;
                        playerData.Host = settings.sourcequery.host;
                        playerData.DataPort = server_settings.port;
                        if (playerData.SteamId !== false || playerData.SteamId !== undefined || playerData.SteamId !== 0) {
                            steamlist.push(playerData.SteamId);
                            qrylist.push(playerData);
                        }
                    }

                });
            })
            .then(() => savePlayers(qrylist))
            .then(() => loadSteam(steamlist))
            .then(() => {
                resolve();
            });
    });
}

module.exports.setupPlayers = () => {

    console.info("Initializing Player Data...");
    return new Promise(function (r, rj) {
        initTable()
            .then(() => setupPlayerFiles())
            .then(() => {
                r();
            })
            .catch(() => rj());
    });


};