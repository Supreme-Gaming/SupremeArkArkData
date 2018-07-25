/*jshint esversion: 6 */
const fs = require('fs');
const parser = require("./parse.js");
const Promise = require('bluebird');
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

function initTable() {
  return new Promise((r, rj) => {
    pool.getConnection((err, connection) => {
      if (err) {
        console.loge(err.message);
        rj(err.message);
      } else {
        // connection.query('DROP TABLE IF EXISTS tribes');
        connection.query('CREATE TABLE IF NOT EXISTS tribes ( `Id` INTEGER  NOT NULL, `Guid` VARCHAR(255) NOT NULL UNIQUE, `Name` VARCHAR(255) NOT NULL, `OwnerId` INT NULL, `FileCreated` BIGINT NULL, `FileUpdated` BIGINT NULL, `TribeLog` MEDIUMTEXT NULL, `PlayMap` VARCHAR(255) NULL, `Host` VARCHAR(255) NULL, `DataPort` INT NULL)', (error, res) => {
          if (error) {
            console.log(error.message);
            rj(error.message);
          }

          connection.release();
          r()
        });
      }

    });
  });
}

function saveTribes(data) {
  console.info("Setting up Tribes...");
  console.log("Setting up Tribes...");

  return new Promise((r, rj) => {

    const template = "INSERT INTO `supremeark_arkdata`.`tribes` (Id,Guid,Name,OwnerId,FileCreated,FileUpdated,TribeLog,PlayMap,Host,DataPort) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE Name=?,OwnerId=?,FileUpdated=?,TribeLog=?,PlayMap=?,Host=?,DataPort=?; ";

    let query = ""

    data.forEach(item => {
      query += mysql.format(template, [item.Id, item.Guid, item.Name, item.OwnerId, item.FileCreated, item.FileUpdated, item.TribeLog, item.PlayMap, item.Host, item.DataPort, item.Name, item.OwnerId, item.FileUpdated, item.TribeLog, item.PlayMap, item.Host, item.DataPort]);
    })

    pool.getConnection((error, connection) => {
      if (error) {
        console.log(error.message);
        rj(error.message);
      }

      connection.query(query, (err, res) => {
        if (err) {
          console.log(err.message)
          rj(error.message);
        }

        connection.release();
        r();
      });
    });
  });

}

var qrylist = [];

var readFilePromisified = Promise.promisify(require("fs").readFile);
var readDirPromisified = Promise.promisify(require("fs").readdir);
module.exports.setupTribes = function() {
  return new Promise((r, rj) => {

    console.log("Initializing Tribe Data...");
    console.info("Initializing Tribe Data...");

    initTable()
      .then(() => readDirPromisified(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Saved", settings.servers[0].server_alt_dir), "utf-8"))
      .then((files) => {
        var players = [];
        var tribeData = {};
        qrylist = [];
        let reqs = files.map((v) => {
          return new Promise(function(resolve) {
            var re = new RegExp("^.*\\.arktribe");

            if (re.test(v)) {
              var data = fs.readFileSync(path.join(path.normalize(settings.servers[0].server_directory), "ShooterGame", "Saved", settings.servers[0].server_alt_dir, v));

              tribeData = {};

              tribeData.Name = parser.getString("TribeName", data);
              tribeData.OwnerId = parser.getUInt32("OwnerPlayerDataID", data);
              tribeData.Id = parser.getInt("TribeID", data);
              tribeData.Guid = parser.getInt("TribeID", data) + '-' + settings.servers[0].rconport;
              var fdata = fs.statSync(path.join(settings.servers[0].server_directory, "ShooterGame", "Saved", settings.servers[0].server_alt_dir, v));
              tribeData.FileCreated = fdata.birthtimeMs.toFixed(0);
              tribeData.FileUpdated = fdata.mtimeMs.toFixed(0);
              //   tribeData.TribeLog = parser.getString("TribeLog", data);
              tribeData.TribeLog = null;
              tribeData.PlayMap = settings.servers[0].map_name;
              tribeData.Host = settings.servers[0].rconport;
              tribeData.DataPort = settings.servers[0].port;
              qrylist.push(tribeData);
            }

            resolve();

          });

        });
        Promise.all(reqs)
          .then(() => saveTribes(qrylist))
          .then(() => r());
      }).catch((err) => {
        rj(err);
      });
  });

};