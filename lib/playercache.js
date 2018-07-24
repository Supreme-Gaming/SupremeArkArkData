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

var steamlist = [];

initTable = () => {
  return new Promise(function(r, rj) {

    pool.getConnection((err, connection) => {
      if (err) {
        rj(err);
      }

      // connection.query('DROP TABLE IF EXISTS players');
      connection.query('create table if not exists players (`Id` INTEGER NOT NULL, `TribeId` INT NULL, `TribeGuid` VARCHAR(255) NULL, `TribeName` VARCHAR(255) NULL, `Level` INT NOT NULL, `Engrams` INT NOT NULL, `SteamId` VARCHAR(255) NOT NULL, `Guid` VARCHAR(255) NOT NULL UNIQUE, `Admin` INT NOT NULL DEFAULT false, `CharacterName` VARCHAR(255) NULL,	`SteamName` VARCHAR(255) NULL, `ProfileUrl` VARCHAR(255) NULL, `AvatarUrl` VARCHAR(255) NULL, `CommunityBanned` INT NULL, `VACBanned` INT NULL, `NumberOfVACBans` INT NULL, `NumberOfGameBans` INT NULL, `DaysSinceLastBan` INT NULL, `Banned` INT NOT NULL DEFAULT false, `FileUpdated` BIGINT NULL, `FileCreated` BIGINT NULL, `PlayMap` VARCHAR(255) NULL, `Host` VARCHAR(255) NULL, `DataPort` INT NULL) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci', function(err, res, fields) {
        connection.release();

        if (err) {
          console.error("INIT error!", err);
          rj(err);
        }

        r();
      });
    });
  });



}

getId = (data) => {
  return parser.getUInt64('PlayerDataID', data);
}

getSteamId = (data) => {
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

getExistingDBplayers = () => {
  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        reject(error);
      }

      connection.query("SELECT * FROM players", (err, res) => {
        if (err) {
          connection.release();
          reject(err);
        }

        connection.release();
        resolve(res);
      })
    })
  })
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
        connection.release();
        reject(error)
      }

      connection.query(query, (err, res) => {
        if (err) {
          connection.release();
          reject(error);
        }

        resolve();
      });
    });

  });

}


loadSteam = (list) => {

  return new Promise(function(r, rj) {
    steamAPIKey = settings.steam_key;
    Steam.ready(steamAPIKey, Promise.coroutine(function*(err) {
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

        linkSteamProfiles(data).then(() => {
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

            linkSteamBans(data).then(() => {
              console.info("Steam bans are done updating!");
              console.log("Steam bans are done updating!");
              r();
            })
          }).catch((err) => {
            console.log(err);
            rj('Steam failed to update cache!');
          });
        })
      }).catch((err) => {
        console.log(e);
        rj('Steam failed to update cache!');
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
        connection.release();
        rj(error)
      }

      connection.query(query, (err, res) => {
        if (err) {
          connection.release();
          rj(error);
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
        connection.release();
        rj(error)
      }

      connection.query(query, (err, res) => {
        if (err) {
          connection.release();
          rj(error);
        }

        connection.release();
        r();
      });
    });
  })
}

var c = 0;
var qrylist = [];
var readFilePromisified = Promise.promisify(require("fs").readFile);
var readDirPromisified = Promise.promisify(require("fs").readdir);

setupPlayerFiles = () => {
  return new Promise(function(resolve, reject) {
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
          banData.forEach(function(elem, i) {
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
            playerData.Guid = getSteamId(data) + '-' + settings.servers[0].rconport;
            playerData.PlayerName = parser.getString("PlayerName", data);
            playerData.Level = parser.getUInt16("CharacterStatusComponent_ExtraCharacterLevel", data) + 1;
            playerData.TotalEngramPoints = parser.getInt("PlayerState_TotalEngramPoints", data);
            playerData.CharacterName = parser.getString("PlayerCharacterName", data);

            if (parser.getInt("TribeID", data) == false) {
              playerData.TribeId = null;
              playerData.TribeGuid = null;
            } else {
              playerData.TribeId = parser.getInt("TribeID", data);
              playerData.TribeGuid = parser.getInt("TribeID", data) + '-' + settings.servers[0].rconport;
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
            playerData.FileCreated = fdata.birthtimeMs.toFixed(0);
            playerData.FileUpdated = fdata.mtimeMs.toFixed(0);
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

  return new Promise(function(r, rj) {

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