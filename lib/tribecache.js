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
        console.log(err.message);
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

module.exports.setupTribes = function() {
  return new Promise((resolve, reject) => {
    const readFilePromisified = Promise.promisify(require("fs").readFile);
    const readDirPromisified = Promise.promisify(require("fs").readdir);

    let qrylist = [];

    let servers = settings.servers.map((server) => {
      return new Promise((r, rj) => {

        console.log(`Initializing ${server.map_name} tribe data...`);

        initTable()
          .then(() => readDirPromisified(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir), "utf-8"))
          .then((files) => {
            let tribeData = {};
            qrylist = [];
            let reqs = files.map((v) => {
              return new Promise(function(resolve) {
                let re = new RegExp("^.*\\.arktribe");

                if (re.test(v)) {
                  let data = fs.readFileSync(path.join(path.normalize(server.server_directory), "ShooterGame", "Saved", server.server_alt_dir, v));

                  tribeData = {};

                  tribeData.Name = parser.getString("TribeName", data);
                  tribeData.OwnerId = parser.getUInt32("OwnerPlayerDataID", data);
                  tribeData.Id = parser.getInt("TribeID", data);
                  tribeData.Guid = parser.getInt("TribeID", data) + '-' + server.rconport;
                  let fdata = fs.statSync(path.join(server.server_directory, "ShooterGame", "Saved", server.server_alt_dir, v));
                  tribeData.FileCreated = fdata.birthtimeMs.toFixed(0);
                  tribeData.FileUpdated = fdata.mtimeMs.toFixed(0);
                  //   tribeData.TribeLog = parser.getString("TribeLog", data);
                  tribeData.TribeLog = null;
                  tribeData.PlayMap = server.map_name;
                  tribeData.Host = server.rconport;
                  tribeData.DataPort = server.port;
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
    });

    Promise.all(servers)
      .then(() => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
};