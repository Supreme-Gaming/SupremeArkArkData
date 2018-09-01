/*jshint esversion: 6 */
const fs = require('fs');
const parser = require("./parse.js");
const Steam = require('steam-webapi');
const Promise = require('bluebird');
const chunk = require('chunk');
const _ = require('underscore');
const mysql = require('mysql');

const path = require('path');
const settings = JSON.parse(fs.readFileSync('./settings.json', 'utf8'));

let pool = mysql.createPool({
  connectionLimit: 10,
  host: settings.db_config.host,
  user: settings.db_config.user,
  password: settings.db_config.password,
  database: settings.db_config.database,
  charset: settings.db_config.charset,
  multipleStatements: true
});

initTable = () => {
  return new Promise(function(r, rj) {

    pool.getConnection((err, connection) => {
      if (err) {
        rj(err);
      }

      // connection.query('DROP TABLE IF EXISTS players');
      connection.query('create table if not exists players (`Id` INTEGER NOT NULL, `TribeId` INT NULL, `TribeGuid` VARCHAR(255) NULL, `TribeName` VARCHAR(255) NULL, `Level` INT NOT NULL, `Engrams` INT NOT NULL, `SteamId` VARCHAR(255) NOT NULL, `Guid` VARCHAR(255) NOT NULL UNIQUE, `Admin` INT NOT NULL DEFAULT false, `CharacterName` VARCHAR(255) NULL,	`SteamName` VARCHAR(255) NULL, `ProfileUrl` VARCHAR(255) NULL, `AvatarUrl` VARCHAR(255) NULL, `CommunityBanned` INT NULL, `VACBanned` INT NULL, `NumberOfVACBans` INT NULL, `NumberOfGameBans` INT NULL, `DaysSinceLastBan` INT NULL, `Banned` INT NOT NULL DEFAULT false, `FileUpdated` BIGINT NULL, `FileCreated` BIGINT NULL, `PlayMap` VARCHAR(255) NULL, `Host` VARCHAR(255) NULL, `DataPort` VARCHAR(255) NULL) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci', function(err, res, fields) {
        if (err) {
          console.error("INIT error!", err);
          rj(err);
        }

        connection.release();
        r();
      });
    });
  });
}

savePlayers = (data) => {

  return new Promise(function(resolve, reject) {

    const template = "INSERT INTO `supremeark_arkdata`.`players` (id,steamid,guid,charactername,level,engrams,tribeid,tribeguid,tribename,banned,admin,fileupdated,filecreated,playmap,host,dataport) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE charactername=?,level=?,engrams=?,tribeid=?,tribeguid=?,tribename=?,banned=?,admin=?,fileupdated=?,playmap=?,host=?,dataport=?; ";

    let query = ""

    data.forEach(item => {
      query += mysql.format(template, [item.Id, item.SteamId, item.Guid, item.CharacterName, item.Level, item.TotalEngramPoints, item.TribeId, item.TribeGuid, item.TribeName, item.Banned, item.Admin, item.FileUpdated, item.FileCreated, item.PlayMap, item.Host, item.DataPort, item.CharacterName, item.Level, item.TotalEngramPoints, item.TribeId, item.TribeGuid, item.TribeName, item.Banned, item.Admin, item.FileUpdated, item.PlayMap, item.Host, item.DataPort]);
    })

    pool.getConnection((error, connection) => {
      if (error) {
        console.log(error.message);
        reject(error.message);
      }

      connection.query(query, (err, res) => {
        if (err) {
          console.log(err.message);
          reject(err.message);
        }

        connection.release();
        resolve();
      });
    });

  });
}


loadSteam = (list) => {

  return new Promise(function(r, rj) {
    // Split the steam id list into arrays of 100
    let steamList = chunk(list, 100);

    Steam.ready(settings.steam_key, Promise.coroutine(function*(err) {
      if (err) {
        rj(err);
      }

      console.log("Caching Steam Info...");

      // Creates an promise wielding function for every method (with Async attached at the end)
      Promise.promisifyAll(Steam.prototype);

      let steam = new Steam({
        key: settings.steam_key
      });

      Promise.map(steamList, (item) => {
          return steam.getPlayerSummariesAsync({
            steamids: item.toString()
          })
        }, {
          concurrency: 1
        })
        .then((res) => {
          return linkSteamProfiles(res);
        })
        .then(() => {
          return Promise.map(steamList, (item) => {
            return new Promise((resolve) => {
              resolve(steam.getPlayerBansAsync({
                steamids: item.toString()
              }));
            });
          }, {
            concurrency: 1
          });
        })
        .then((res) => {
          return linkSteamBans(res);
        })
        .then((res) => {
          console.log("Steam bans are done updating!");
          r();
        })
        .catch((err) => {
          rj(`Steam failed to update cache: ${err}`);
        });
    }));
  });
}

linkSteamProfiles = (data) => {
  return new Promise((r, rj) => {
    const template = "UPDATE `supremeark_arkdata`.`players` SET SteamName = ?, ProfileUrl = ?, AvatarUrl = ? WHERE SteamId = ?; ";

    let steamItems = [];
    let query = ""

    data.forEach((set) => {
      return set.players.forEach(player => {
        steamItems.push(player);
      });
    });

    steamItems.forEach(item => {
      query += mysql.format(template, [item.personaname, item.profileurl, item.avatarfull, item.steamid]);
    })

    pool.getConnection((error, connection) => {
      if (error) {
        console.log(error.message);
        rj(error.message);
      }

      connection.query(query, (err, res) => {
        if (err) {
          console.log(err.message);
          rj(err.message);
        }

        connection.release();
        r();
      });
    });
  });
}

linkSteamBans = (data) => {
  return new Promise((r, rj) => {
    const template = "update `supremeark_arkdata`.`players` SET communitybanned = ?, vacbanned = ?, numberofvacbans = ?, numberofgamebans = ?, dayssincelastban = ? WHERE steamid = ?; ";

    let steamItems = [];
    let query = ""

    data.forEach((set) => {
      return set.players.forEach(player => {
        steamItems.push(player);
      });
    });

    steamItems.forEach(item => {
      query += mysql.format(template, [item.CommunityBanned, item.VACBanned, item.NumberOfVACBans, item.NumberOfGameBans, item.DaysSinceLastBan, item.SteamId]);
    })

    pool.getConnection((error, connection) => {
      if (error) {
        console.log(error.message);
        rj(error.message);
      }

      connection.query(query, (err, res) => {
        if (err) {
          console.log(err.message);
          rj(err.message);
        }

        connection.release();
        r();
      });
    });
  })
}

getId = (data) => {
  return parser.getUInt64('PlayerDataID', data);
}

getSteamId = (data) => {
  let d = new Buffer(data);
  let type = 'UniqueNetIdRepl';
  let bytes1 = d.indexOf(type);
  if (bytes1 == -1) {
    return false;
  }
  let start = bytes1 + type.length + 9;
  let end = start + 17;
  return d.slice(start, end).toString();
}

setupPlayerFiles = () => {
  return new Promise((r, rj) => {
    const readFilePromisified = Promise.promisify(require("fs").readFile);
    const readDirPromisified = Promise.promisify(require("fs").readdir);

    let serversToProcess = settings.servers.filter((s) => {
      return s.shouldProcess;
    });

    if (serversToProcess.length > 0) {
      let servers = serversToProcess.map((server) => {
        return new Promise(function(resolve, reject) {
          let playerData = {};
          let banplayers = [];

          let steamList = [];
          let qrylist = [];

          let banData;
          let adminData;
          let admins;

          readFilePromisified(path.join(path.normalize(server.server_directory), "ShooterGame", "Binaries", "Linux", "BanList.txt"), "ucs2")
            .then((data) => {
              banData = data;
            })
            .catch((err) => {
              console.log(`Doesn't look like ${server.map_name} bans are in the Linux Folder, going to try the Windows location...`);
            })
            .then(() => readFilePromisified(path.join(path.normalize(server.server_directory), "ShooterGame", "Binaries", "Win64", "BanList.txt"), "ucs2"))
            .then((data) => {
              banData = data;
            }).catch((err) => {
              if (banData === undefined) {
                console.log(`No ${server.map_name} ban file found, not loading server bans...`);
              }
            })
            .then(() => readFilePromisified(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", "AllowedCheaterSteamIDs.txt"), "utf-8"))
            .catch((err) => {
              console.log(`No ${server.map_name} Admins Detected!`);
            })
            .then((data) => {
              adminData = data;
            })
            .then(() => readDirPromisified(path.join(path.normalize(path.normalize(server.server_directory)), "ShooterGame", "Saved", server.server_alt_dir), "utf-8"))
            .then((files) => {
              if (adminData !== undefined) {
                admins = adminData;
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
                banData.forEach(function(elem, i) {
                  let a = elem.split(",");
                  if (banData[i] === "") {
                    banData.splice(i);
                    return true;
                  }
                  banplayers.push(a[0]);
                });
              }
              files.map((v) => {
                let re = new RegExp("^.*\\.arkprofile");
                if (re.test(v)) {
                  let data = fs.readFileSync(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir, v));
                  playerData = {};
                  playerData.Id = getId(data);
                  playerData.SteamId = getSteamId(data);
                  playerData.Guid = getSteamId(data) + '-' + server.port;
                  playerData.PlayerName = parser.getString("PlayerName", data);
                  playerData.Level = parser.getUInt16("CharacterStatusComponent_ExtraCharacterLevel", data) + 1;
                  playerData.TotalEngramPoints = parser.getInt("PlayerState_TotalEngramPoints", data);
                  playerData.CharacterName = parser.getString("PlayerCharacterName", data);

                  if (parser.getInt("TribeID", data) == false) {
                    playerData.TribeId = null;
                    playerData.TribeGuid = null;
                  } else {
                    playerData.TribeId = parser.getInt("TribeID", data);
                    playerData.TribeGuid = parser.getInt("TribeID", data) + '-' + server.port;
                  }

                  if (playerData.TribeId > 0) {
                    if (fs.existsSync(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir, playerData.TribeId + '.arktribe'))) {
                      let tribeData = fs.readFileSync(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir, playerData.TribeId + '.arktribe'));
                      playerData.TribeName = parser.getString("TribeName", tribeData);
                    } else {
                      playerData.TribeName = 'null';
                    }
                  }
                  let fdata = fs.statSync(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir, v));
                  playerData.FileCreated = fdata.birthtimeMs.toFixed(0);
                  playerData.FileUpdated = fdata.mtimeMs.toFixed(0);
                  playerData.Banned = _.indexOf(banplayers, playerData.SteamId) > -1 ? true : false;
                  playerData.Admin = _.indexOf(admins, playerData.SteamId) > -1 ? true : false;
                  playerData.Level = parser.getUInt16("CharacterStatusComponent_ExtraCharacterLevel", data) + 1;
                  playerData.TotalEngramPoints = parser.getInt("PlayerState_TotalEngramPoints", data);
                  playerData.CharacterName = parser.getString("PlayerCharacterName", data);

                  if (parser.getInt("TribeID", data) == false) {
                    playerData.TribeId = null;
                    playerData.TribeGuid = null;
                  } else {
                    playerData.TribeId = parser.getInt("TribeID", data);
                    playerData.TribeGuid = parser.getInt("TribeID", data) + '-' + server.port;
                  }

                  if (playerData.TribeId > 0) {
                    if (fs.existsSync(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir, playerData.TribeId + '.arktribe'))) {
                      let tribeData = fs.readFileSync(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir, playerData.TribeId + '.arktribe'));
                      playerData.TribeName = parser.getString("TribeName", tribeData);
                    } else {
                      playerData.TribeName = 'null';
                    }
                  }

                  playerData.Banned = _.indexOf(banplayers, playerData.SteamId) > -1 ? true : false;
                  playerData.Admin = _.indexOf(admins, playerData.SteamId) > -1 ? true : false;
                  playerData.PlayMap = server.map_name;
                  playerData.Host = server.port;
                  playerData.DataPort = server.port;
                  if (playerData.SteamId !== false || playerData.SteamId !== undefined || playerData.SteamId !== 0) {
                    steamList.push(playerData.SteamId);
                    qrylist.push(playerData);
                  }
                }

              });
            })
            .then(() => savePlayers(qrylist))
            .then(() => loadSteam(steamList))
            .then(() => {
              resolve();
            })
            .catch((err) => {
              reject(err);
            })
        });
      });

      Promise.all(servers)
        .then(() => {
          r();
        })
        .catch((err) => {
          rj(err);
        });
    } else {
      r();
    }
  });
}

module.exports.setupPlayers = () => {

  return new Promise(function(r, rj) {

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