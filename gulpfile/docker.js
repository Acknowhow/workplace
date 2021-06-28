const spawn = require('child_process').spawn;
const path = require('path');
const fs = require('fs');
const YAML = require('yaml');

const { PROJECT_FILE, updateGitignore } = require('./gitignore');

const getVolumeName = (projectType, type) => `${projectType}-${type}`;
const networkName = 'net';

const projectTypes = ['magento1', 'magento2', 'symfony'];

const getServiceConfig = (config, service) => {
  if (!Object.prototype.hasOwnProperty.call(config, service)) {
    return [false, false];
  }
  const { image = false, port = false  } = config[service];
  return [image, port];
};

const optionalService = (
  projectName, name, image, port = false, portDefault, env = [], volume = [], dependsOn = [], network = []
) => image ? {
  [name]: Object.assign(
    {},
    {
      container_name: `${projectName}-${name}`,
      // networks: [networkName],
      image: image,
    },

    port ? {
      ports: [`${port}:${portDefault}`],
    } : {},

    network.length > 0 ? {
        networks: network
    } : {},

    volume.length > 0 ? {
      volumes: volume,
    } : {},

    dependsOn.length > 0 ? {
        depends_on: dependsOn,
    } : {},

    env.length > 0 ? {
      environment: env
    } : {}
  ),
} : {};

const optionalVolume = (image, name) => image ? { [name]: {} } : {};

const fileTemplate = (
  projectType,

  projectRoot,
  workplaceRoot,
  projectName,
  [phpImage, _phpPort, phpEnv = []],
  [nginxImage,  nginxPort, nginxEnv = []],
  [dbImage, dbPort, dbEnv = []],
  [seleniumImage, seleniumPort, seleniumEnv = []],
  [redisImage = null, redisPort = null, redisEnv = []],
  [elasticImage = null, elasticPort = null, elasticEnv = []],
  [varnishImage = null, varnishPort = null, varnishEnv = []],
  [clickhouseImage = null, clickhousePort = null, clickhouseEnv = []],
  [rabbitmqImage = null, rabbitmqPort = null, rabbitmqEnv = []],
  [firefoxImage = null, firefoxPort = null, firefoxEnv = []],
  [chromeImage = null, chromePort = null, chromeEnv = []]
) => JSON.stringify({
  version: '3.7',
  services: Object.assign(
    {},
    {
      php: {
        container_name: `${projectName}-php`,
        image: phpImage,
        // networks: [networkName],
        volumes: [`${projectRoot}:/var/www/${projectType}`],
        environment: ['PHPFPM_USER=$USERID', ...phpEnv],
        depends_on: ['db'],
      },
      nginx: {
        container_name: `${projectName}-nginx`,
        image: nginxImage,
        // networks: [networkName],
        environment: ['NGINX_USER=$USERID', ...nginxEnv],
        volumes: [
          `${workplaceRoot}:/etc/nginx/sites-enabled/`,
          `${projectRoot}:/var/www/${projectType}`,
        ],
        ports: [`${nginxPort}:80`],
        depends_on: ['php'],
      },
      db: {
        container_name: `${projectName}-db`,
        image: dbImage,
        // networks: [networkName],
        ports: [`${dbPort}:3306`],
        environment: [
          'MYSQL_ROOT_PASSWORD=mygento',
          `MYSQL_DATABASE=${projectType}`,
          'MYSQL_USER=mygento',
          'MYSQL_PASSWORD=mygento',
          ...dbEnv
        ],
        volumes: [`${getVolumeName(projectType, 'db')}:/var/lib/mysql`],
      },
      selenium: {
          container_name: `${projectName}-selenium`,
          image: seleniumImage,
          // networks: ['grid'],
          ports: [
              '4442:4442',
              '4443:4443',
              `${seleniumPort}:4444`
          ]
      }
    },
    optionalService(projectName, 'redis', redisImage, redisPort, 6379, redisEnv, []),
    optionalService(projectName, 'elastic', elasticImage, elasticPort, 9200, ['discovery.type=single-node', ...elasticEnv], ['elastic:/usr/share/elasticsearch/data']),
    optionalService(projectName, 'varnish', varnishImage, varnishPort, 8081, varnishEnv, []),
    optionalService(projectName, 'clickhouse', clickhouseImage, clickhousePort, 8123, clickhouseEnv, ['clickhouse:/var/lib/clickhouse']),
    optionalService(projectName, 'rabbitmq', rabbitmqImage, rabbitmqPort, 5672, rabbitmqEnv, ['rabbitmq:/var/lib/rabbitmq']),
    optionalService(projectName, 'firefox', firefoxImage, firefoxPort, 5900, [
        'SE_EVENT_BUS_HOST=selenium', 'SE_EVENT_BUS_PUBLISH_PORT=4442', 'SE_EVENT_BUS_SUBSCRIBE_PORT=4443', ...firefoxEnv],
        ['/dev/shm:/dev/shm'], ['selenium']),
    optionalService(projectName, 'chrome', chromeImage, chromePort, 5900, [
        'SE_EVENT_BUS_HOST=selenium', 'SE_EVENT_BUS_PUBLISH_PORT=4442', 'SE_EVENT_BUS_SUBSCRIBE_PORT=4443', ...chromeEnv],
        ['/dev/shm:/dev/shm'], ['selenium']),
  ),
  volumes: Object.assign(
    {},
    { [getVolumeName(projectType, 'db')]: {} },
    optionalVolume(elasticImage, 'elastic'),
    optionalVolume(clickhouseImage, 'clickhouse'),
    optionalVolume(rabbitmqImage, 'rabbitmq')
  ),
  // networks: {
  //   ['grid']: {
  //     driver: 'bridge',
  //     driver_opts: {
  //       'com.docker.network.enable_ipv6': 'false',
  //       'com.docker.network.bridge.name': 'dolce-myfit'
  //     }
  //   }
  // }
}, null, 2);

const runCommand = (command, config, cb) => {
  console.log('command is', command);
  // Local package.json config
  console.log('config is', config);
  console.log('cb is', cb);

  fs.writeFileSync(
    path.join(config.appDirectory, PROJECT_FILE, 'docker-compose.json'),
    fileTemplate(
      config.type,
      config.appDirectory,
      path.resolve(`../nginx/${config.type}`),
      config.projectName,
      [config.php.image, config.php.port, config.php.env],
      [config.nginx.image,  config.nginx.port, config.nginx.env],
      [config.mysql.image,  config.mysql.port, config.mysql.env],
      [config.selenium.image, config.selenium.port, config.selenium.env],
      getServiceConfig(config, 'redis'),
      getServiceConfig(config, 'elasticsearch'),
      getServiceConfig(config, 'varnish'),
      getServiceConfig(config, 'clickhouse'),
      getServiceConfig(config, 'rabbitmq'),
      getServiceConfig(config, 'firefox'),
      getServiceConfig(config, 'chrome')
    )
  );

  try {
      const jsonStr = fs.readFileSync(
          path.join(config.appDirectory, PROJECT_FILE, 'docker-compose.json'), 'utf8');
      const jsonData = JSON.parse(jsonStr);

      fs.writeFileSync(path.join(config.appDirectory, PROJECT_FILE, 'docker-compose.yml'), YAML.stringify(jsonData));
  } catch (err) {
      console.error(err);
  }

  // const cmd = spawn(
  //   'docker-compose',
  //   ['-f','docker-compose.json', ...command],
  //   { stdio: 'inherit', cwd: path.join(config.appDirectory, PROJECT_FILE) }
  // );
  cmd.on('close', function(code) {
    if (code !== 0) {
      console.log('docker exited on close with code ' + code);
    }
    cb(code);
  });
  cmd.on('error', function(code) {
    console.log('docker exited on error with code ' + code);
    cb(code);
  });
};

exports.composeCommand = (cb, command, config) => {
  if (!projectTypes.includes(config.type)) {
    return cb();
  }
  updateGitignore(config.appDirectory);

  // Checks directory and creates workplace dir if needed
  if (!fs.existsSync(path.join(config.appDirectory, PROJECT_FILE))) {
    fs.mkdirSync(path.join(config.appDirectory, PROJECT_FILE));
  }

  process.env.COMPOSE_PROJECT_NAME = config.projectName;
  process.env.USERID = require('os').userInfo().uid;

  // fs.writeFileSync(
  //   path.join(config.appDirectory, PROJECT_FILE, 'docker-compose.json'),
  //   fileTemplate(
  //     config.type,
  //     config.appDirectory,
  //     path.resolve(`../nginx/${config.type}`),
  //     config.projectName,
  //     [config.php.image, config.php.port, config.php.env],
  //     [config.nginx.image,  config.nginx.port, config.nginx.env],
  //     [config.mysql.image,  config.mysql.port, config.mysql.env],
  //     getServiceConfig(config, 'redis'),
  //     getServiceConfig(config, 'elasticsearch'),
  //     getServiceConfig(config, 'varnish'),
  //     getServiceConfig(config, 'clickhouse'),
  //     getServiceConfig(config, 'rabbitmq')
  //   )
  // );

  runCommand(command, config, cb);
};
