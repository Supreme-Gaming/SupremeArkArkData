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
let connection;

let pool = mysql.createPool({
    connectionLimit: 10,
    host: settings.db_config.host,
    user: settings.db_config.user,
    password: settings.db_config.password,
    database: settings.db_config.database,
    charset: settings.db_config.charset
});

pool.getConnection((err, cn) => {
    if (err) {
        throw new Error(err);
    } else {
        connection = cn;
    }
});

var steamlist = [];
var initialized = false;

function initTable() {
    return new Promise(function (r, rj) {
        // if (initialized) {
        //     resolve();
        //     return false;
        // }

        pool.getConnection((err, connection) => {
            if (err) {
                rj(err);
            }

            connection.query('DROP TABLE IF EXISTS players');
            connection.query('create table if not exists players (`Id` INTEGER NOT NULL UNIQUE, `TribeId` INT NULL, `TribeName` VARCHAR(255) NULL, `Level` INT NOT NULL, `Engrams` INT NOT NULL, `SteamId` VARCHAR(255) NOT NULL UNIQUE, `Admin` bit NOT NULL DEFAULT false, `CharacterName` VARCHAR(255) NULL,	`SteamName` VARCHAR(255) NULL, `ProfileUrl` VARCHAR(255) NULL, `AvatarUrl` VARCHAR(255) NULL, `CommunityBanned` INT NULL, `VACBanned` INT NULL, `NumberOfVACBans` INT NULL, `NumberOfGameBans` INT NULL, `DaysSinceLastBan` INT NULL, `Banned` bit NOT NULL DEFAULT false, `FileUpdated` DATETIME NULL, `FileCreated` DATETIME NULL, `PlayMap` VARCHAR(255) NULL, `Host` VARCHAR(255) NULL, `DataPort` INT NULL) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci', function (err, res, fields) {
                connection.release();

                if (err) {
                    console.error("INIT error!", err);
                    rj(err);
                }

                initialized = true;
                r();
            });
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

function checkId(id, cn, cb) {

    if (cn) {
        cn.query("SELECT id from players where Id = ?", id, (err, row) => {
            if (err) {
                throw new Error(err);
            }

            cb(row);
        });
    }
}


function savePlayers(data) {

    return new Promise(function (resolve, reject) {
        // connection.query("BEGIN", function (err) {
        //     if (err) {
        //         console.trace("saveplayer error!");
        //     }
        // });

        let reqs;

        pool.getConnection((err, connection) => {
            if (err) {
                rj(err);
            }

            reqs = data.map((item) => {
                return new Promise((r, rj) => {
                    checkId(item.Id, connection, function (d) {
                        // If no item in db, add
                        if (d.length == 0) {

                            connection.query("INSERT INTO `supremeark_arkdata`.`players` (id,steamid,charactername,level,engrams,tribeid,tribename,banned,admin,fileupdated,filecreated,playmap,host,dataport) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [item.Id, item.SteamId, item.CharacterName, item.Level, item.TotalEngramPoints, item.TribeId, item.TribeName, item.Banned, item.Admin, item.FileUpdated, item.FileCreated, item.PlayMap, item.Host, item.DataPort], function (err, res) {
                                if (err) {
                                    console.log("LINE 96:", err, "\n Will attempt to fix broken cache record...");
                                    connection.query("Delete from players where steamid = ?", item.SteamId, (err, res) => {
                                        if (err) {
                                            rj(err);
                                        } else {
                                            console.log("Removed conflicting db entry...");

                                            connection.query("INSERT INTO players (id,steamid,charactername,level,engrams,tribeid,tribename,fileupdated,banned,admin,filecreated,playmap,host,dataport) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [item.Id, item.SteamId, item.CharacterName, item.Level, item.TotalEngramPoints, item.TribeId, item.TribeName, item.Banned, item.Admin, item.FileUpdated, item.FileCreated, item.PlayMap, item.Host, item.DataPort], function (err, res) {
                                                if (err) {
                                                    console.log("Failed to fix cache record for steamid: " + item.steamId);
                                                    rj(err);
                                                } else {
                                                    console.log("Cache record fixed successfully!");
                                                    r();
                                                }
                                            });
                                        }
                                    });
                                } else {
                                    r();
                                }
                            });
                        }
                    });
                });
            });

            Promise.all(reqs).then(() => {
                resolve();
            }).catch((err) => {
                reject(err);
            });

        });
    });

}


function loadSteam(list) {

    return new Promise(function (r, rj) {
        steamAPIKey = settings.steam_key;
        Steam.ready(steamAPIKey, Promise.coroutine(function* (err) {
            if (err) {
                return cb(err);
            }
            console.info("Caching Steam Info...");
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
                pool.getConnection((err, connection) => {
                    if (err) {
                        console.trace("loadsteam error!");
                    } else {
                        linkSteamProfiles(data, function () {
                            console.info("Profiles are done updating!");
                            console.log("Profiles are done updating!");

                            let banreqs = steamlist.map((item) => {
                                return new Promise((resolve) => {
                                    resolve(steam.getPlayerBansAsync({
                                        steamids: item.toString()
                                    }));
                                });
                            });

                            Promise.all(banreqs).then((data) => {
                                // connection.query("BEGIN", function (err) {
                                //     if (err) {
                                //         console.trace("loadsteam error!");
                                //     }

                                // });
                                linkSteamBans(data, function () {
                                    console.info("Steam bans are done updating!");
                                    console.log("Steam bans are done updating!");
                                    connection.release();
                                    r();
                                    // connection.query("COMMIT");
                                });
                            }).catch((err) => {
                                connection.release();
                                console.log(err);
                                rj('Steam failed to update cache!');
                            });
                        });
                    }
                });
            }).catch((err) => {
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
        return new Promise((r, rj) => {
            let reqss = item.players.map((itemm) => {
                return new Promise((r, rj) => {
                    pool.getConnection((err, connection) => {
                        if (err) {
                            rj(err);
                        }

                        connection.query(qry, [itemm.personaname, itemm.profileurl, itemm.avatarfull, itemm.steamid], (err, res) => {
                            if (err) {
                                connection.release();
                                rj(err);
                            }

                            connection.release();
                            r();
                        });
                    });
                });
            });
            Promise.all(reqss).then(() => {
                r();
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
        return new Promise((r, rj) => {
            let reqss = item.players.map((subItem) => {
                return new Promise((r, rj) => {
                    pool.getConnection((err, connection) => {
                        if (err) {
                            rj(err);
                        } else {
                            connection.query(qry, [subItem.CommunityBanned, subItem.VACBanned, subItem.NumberOfVACBans, subItem.NumberOfGameBans, subItem.DaysSinceLastBan, subItem.SteamId], (err) => {
                                if (err) {
                                    connection.release();
                                    r(err);
                                }

                                connection.release();
                                r();
                            });
                        }
                    });
                });
            });

            Promise.all(reqss).then(() => {
                r();
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
        readFilePromisified(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Binaries", "Linux", "BanList.txt"), "ucs2")
            .then((data) => {
                banData = data;
            })
            .catch((err) => {
                console.log("Doesn't look like bans are in the Linux Folder, going to try the Windows location...");
            })
            .then(() => readFilePromisified(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Binaries", "Win64", "BanList.txt"), "ucs2"))
            .then((data) => {
                banData = data;
            }).catch((err) => {
                if (banData === undefined) {
                    console.log("No ban file found, not loading server bans...");
                }
            })
            .then(() => readFilePromisified(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Saved", "AllowedCheaterSteamIDs.txt"), "utf-8"))
            .catch((err) => {
                console.log("No Admins Detected!");
            })
            .then((data) => {
                adminData = data;
            })
            .then(() => readDirPromisified(path.join(path.normalize(path.normalize(settings.servers[0].server_directory)), "ShooterGame", "Saved", settings.servers[0].server_alt_dir), "utf-8"))
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
                        var data = fs.readFileSync(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Saved", settings.servers[0].server_alt_dir, v));
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
                            if (fs.existsSync(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Saved", settings.servers[0].server_alt_dir, playerData.TribeId + '.arktribe'))) {
                                var tribeData = fs.readFileSync(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Saved", settings.servers[0].server_alt_dir, playerData.TribeId + '.arktribe'));
                                playerData.TribeName = parser.getString("TribeName", tribeData);
                            } else {
                                playerData.TribeName = 'null';
                            }
                        }
                        var fdata = fs.statSync(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Saved", settings.servers[0].server_alt_dir, v));
                        playerData.FileCreated = new Date(fdata.birthtime);
                        playerData.FileCreated = playerData.FileCreated.toISOString().slice(0, 19).replace('T', ' ');
                        playerData.FileUpdated = new Date(fdata.mtime);
                        playerData.FileUpdated = playerData.FileUpdated.toISOString().slice(0, 19).replace('T', ' ');
                        playerData.Banned = _.indexOf(banplayers, playerData.SteamId) > -1 ? true : false;
                        playerData.Admin = _.indexOf(admins, playerData.SteamId) > -1 ? true : false;
                        playerData.PlayMap = settings.servers[0].map_name;
                        playerData.Host = settings.servers[0].rconport;
                        playerData.DataPort = settings.server_config.port;
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

    return new Promise(function (r, rj) {

        console.info("Initializing Player Data...");
        console.log("Initializing Player Data...");

        initTable()
            .then(() => setupPlayerFiles())
            .then(() => {
                r();
            })
            .catch((err) => {
                rj(err)
            });
    });

};