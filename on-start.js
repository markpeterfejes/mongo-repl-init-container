/*
JS Version: ES2017
Mongo init container script. Makes the use of stateful sets possible
*/
const dns = require("dns");
const cp = require("child_process");
const fs = require("fs");
const util = require('util');
const hostname = require("os").hostname();
const exec = util.promisify(cp.exec);

const mongodConfPath = "/mongod-config/mongod.conf";
const mongoConf = JSON.parse(fs.readFileSync(mongodConfPath, { encoding: "utf8" }));

let dnsNamespace = "";
let FQDN = "";

let alivePods = [];

// Copy the healthCheck script into position
fs.createReadStream("/mongo-init/healthCheck.sh").pipe(fs.createWriteStream("/workdir/health-check.sh"));
exec("chmod +x /workdir/health-check.sh");

dns.lookup(hostname, { family: 4, hints: dns.ADDRCONFIG }, function (err, ip)
{
    dns.lookupService(ip, 0, function (err, fqdn, service)
    {
        if (err)
        {
            throw err;
        }
        console.log('FQDN: ' + fqdn);
        FQDN = fqdn;
        dnsNamespace = FQDN.slice(hostname.length + 1);

        dns.resolveSrv(dnsNamespace, resolveCallback);
    });
});

function resolveCallback(err, addresses)
{
    if (err)
    {
        if (err.code === "ENOTFOUND" || err.code === "ENODATA")
        {
            console.log("Seems like there are no other nodes alive (" + err.code + ")");
        }
        else
        {
            throw err;
        }
    }
    else
    {
        for (const address of addresses)
        {
            alivePods.push(address.name);
        }

        console.log("Found peers: ", addresses);
    }

    setupMongoReplication();
}

async function setupMongoReplication()
{
    let mongod = null;
    try
    {
        console.log("Spawning mongod");
        mongod = cp.spawn("mongod", ["--config", mongodConfPath], { shell: true });

        await waitForMongoInit();

        console.log("Mongo is ready");

        const primaryAddress = await searchForPrimary();

        if (primaryAddress !== null)
        {
            await initSecondary(primaryAddress);
            await shutdownMongo(20);
        }
        else
        {
            await initPrimary();
            await shutdownMongo();
        }
    }
    catch (err)
    {
        console.error(err);
        if (mongod !== null)
        {
            await shutdownMongo();
        }

        process.exit(1);
    }
}

async function isMongoReady()
{
    try
    {
        const { stdout, stderr } = await exec(`mongo --eval "db.adminCommand('ping')"`, { timeout: 10000 });

        if (stdout.includes(`"ok" : 1`))
        {
            return true;
        }
        return false;
    }
    catch (err)
    {
        if (err.stderr.includes("exception: connect failed"))
        {
            return false;
        }
        else
        {
            throw err;
        }
    }
}

async function waitForMongoInit()
{
    let tryAgain = true;

    const timeout = setTimeout(() =>
    {
        tryAgain = false;
    }, 60000);

    while (tryAgain)
    {
        if (await isMongoReady())
        {
            clearTimeout(timeout);
            return;
        }
    }
    throw "Timeout while waiting for mongod init";
}

async function initPrimary()
{
    console.log("Initializing myself as primary...");

    const replicaSetId = mongoConf.replication.replSetName;

    const { stdout: replicaSetStatus } = await exec('mongo --eval "rs.status()"');

    if (replicaSetStatus.includes("no replset config has been received"))
    {
        console.log("Init new Replica Set");
        const { stdout: initReplSet } = await exec(`mongo --eval "rs.initiate({'_id': '${replicaSetId}', 'members': [{'_id': 0, 'host': '${FQDN}'}]})"`);

        if (!initReplSet.includes('"ok" : 1'))
        {
            throw "Cannot initialize replica set!\n" + initReplSet;
        }

        console.log("ReplicaSet initialized!");
    }
    else if (replicaSetStatus.includes(FQDN))
    {
        console.log("ReplicaSet already initialized");
    }
    else
    {
        throw "Error while initializing replicaSet:\n" + replicaSetStatus;
    }
}

async function searchForPrimary()
{
    console.log("Searching for existing Primary...");

    for (const podAddress of alivePods)
    {
        if (podAddress === FQDN)
        {
            continue;
        }

        try
        {
            const { stdout: isMasterOutput, stderr } = await exec(`mongo admin --host "${podAddress}" --eval "rs.isMaster()"`);

            if (isMasterOutput.includes('"ismaster" : true'))
            {
                console.log("Primary found: " + podAddress);
                return podAddress;
            }
        }
        catch (err)
        {
            throw err;
        }
    }
    console.log("There is no active primary");
    return null;
}

async function initSecondary(primaryAddress)
{
    console.log("Checking if the primary already knows about me...");
    const { stdout: statusOutput } = await exec(`mongo admin --host "${primaryAddress}" --eval "rs.config()"`);

    if (statusOutput.includes(FQDN))
    {
        console.log("The Primary is already aware of me. No need to add myself.");
        return;
    }

    console.log("Nope. Adding myself...");
    const { stdout: rsAddOutput } = await exec(`mongo admin --host "${primaryAddress}" --eval "rs.add('${FQDN}')"`);

    if (!rsAddOutput.includes('"ok" : 1'))
    {
        throw "Failed to add myself to the replicaset";
    }
    console.log("Successfully added myself to the replica set of " + primaryAddress);
}

async function shutdownMongo(timeoutInSec)
{
    let commandArg = "force: true";

    if (timeoutInSec !== undefined && !isNaN(timeoutInSec))
    {
        commandArg = "timeoutSecs: " + timeoutInSec;
    }

    console.log("Shutting down mongo");
    await exec(`mongo admin --eval "db.shutdownServer({${commandArg}})"`);
    console.log("Bye");
}
