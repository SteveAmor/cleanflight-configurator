'use strict';

// code below is highly experimental, although it runs fine on latest firmware
// the data inside nested objects needs to be verified if deep copy works properly
function configuration_backup(callback) {
    var activeProfile = null,
        profilesN = 3;

    var configuration = {
        'generatedBy': chrome.runtime.getManifest().version,
        'apiVersion': CONFIG.apiVersion,
        'profiles': [],
    };

    MSP.send_message(MSP_codes.MSP_STATUS, false, false, function () {
        activeProfile = CONFIG.profile;
        select_profile();
    });

    function select_profile() {
        if (activeProfile > 0) {
            MSP.send_message(MSP_codes.MSP_SELECT_SETTING, [0], false, fetch_specific_data);
        } else {
            fetch_specific_data();
        }
    }

    var profileSpecificData = [
        MSP_codes.MSP_PID_CONTROLLER,
        MSP_codes.MSP_PID,
        MSP_codes.MSP_RC_TUNING,
        MSP_codes.MSP_ACC_TRIM,
        MSP_codes.MSP_SERVO_CONF,
        MSP_codes.MSP_CHANNEL_FORWARDING,
        MSP_codes.MSP_MODE_RANGES,
        MSP_codes.MSP_ADJUSTMENT_RANGES
    ];

    function fetch_specific_data() {
        var fetchingProfile = 0,
            codeKey = 0;

        function fetch_specific_data_item() {
            if (fetchingProfile < profilesN) {
                MSP.send_message(profileSpecificData[codeKey], false, false, function () {
                    codeKey++;

                    if (codeKey < profileSpecificData.length) {
                        fetch_specific_data_item();
                    } else {
                        configuration.profiles.push({
                            'PID': jQuery.extend(true, {}, PID),
                            'PIDs': jQuery.extend(true, [], PIDs),
                            'RC': jQuery.extend(true, {}, RC_tuning),
                            'AccTrim': jQuery.extend(true, [], CONFIG.accelerometerTrims),
                            'ServoConfig': jQuery.extend(true, [], SERVO_CONFIG),
                            'ModeRanges': jQuery.extend(true, [], MODE_RANGES),
                            'AdjustmentRanges': jQuery.extend(true, [], ADJUSTMENT_RANGES)
                        });

                        codeKey = 0;
                        fetchingProfile++;

                        MSP.send_message(MSP_codes.MSP_SELECT_SETTING, [fetchingProfile], false, fetch_specific_data_item);
                    }
                });
            } else {
                MSP.send_message(MSP_codes.MSP_SELECT_SETTING, [activeProfile], false, fetch_unique_data);
            }
        }

        // start fetching
        fetch_specific_data_item();
    }

    var uniqueData = [
        MSP_codes.MSP_MISC,
        MSP_codes.MSP_RX_MAP,
        MSP_codes.MSP_BF_CONFIG,
        MSP_codes.MSP_CF_SERIAL_CONFIG,
        MSP_codes.MSP_LED_STRIP_CONFIG
    ];

    function update_unique_data_list() {
        if (semver.gte(CONFIG.apiVersion, "1.8.0")) {
            uniqueData.push(MSP_codes.MSP_LOOP_TIME);
            uniqueData.push(MSP_codes.MSP_ARMING_CONFIG);
        }
    }
    
    update_unique_data_list();

    function fetch_unique_data() {
        var codeKey = 0;
        
        function fetch_unique_data_item() {
            if (codeKey < uniqueData.length) {
                MSP.send_message(uniqueData[codeKey], false, false, function () {
                    codeKey++;
                    fetch_unique_data_item();
                });
            } else {
                configuration.MISC = jQuery.extend(true, {}, MISC);
                configuration.RCMAP = jQuery.extend(true, [], RC_MAP);
                configuration.BF_CONFIG = jQuery.extend(true, {}, BF_CONFIG);
                configuration.SERIAL_CONFIG = jQuery.extend(true, {}, SERIAL_CONFIG);
                configuration.LED_STRIP = jQuery.extend(true, [], LED_STRIP);
                
                if (semver.gte(CONFIG.apiVersion, "1.8.0")) {
                    configuration.FC_CONFIG = jQuery.extend(true, {}, FC_CONFIG);
                    configuration.ARMING_CONFIG = jQuery.extend(true, {}, ARMING_CONFIG);
                }

                save();
            }
        }
        
        // start fetching
        fetch_unique_data_item();
    }

    function save() {
        var chosenFileEntry = null;

        var accepts = [{
            extensions: ['txt']
        }];

        // generate timestamp for the backup file
        var d = new Date(),
            now = (d.getMonth() + 1) + '.' + d.getDate() + '.' + d.getFullYear() + '.' + d.getHours() + '.' + d.getMinutes();

        // create or load the file
        chrome.fileSystem.chooseEntry({type: 'saveFile', suggestedName: 'cleanflight_backup_' + now, accepts: accepts}, function (fileEntry) {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                return;
            }

            if (!fileEntry) {
                console.log('No file selected, backup aborted.');
                return;
            }

            chosenFileEntry = fileEntry;

            // echo/console log path specified
            chrome.fileSystem.getDisplayPath(chosenFileEntry, function (path) {
                console.log('Backup file path: ' + path);
            });

            // change file entry from read only to read/write
            chrome.fileSystem.getWritableEntry(chosenFileEntry, function (fileEntryWritable) {
                // check if file is writable
                chrome.fileSystem.isWritableEntry(fileEntryWritable, function (isWritable) {
                    if (isWritable) {
                        chosenFileEntry = fileEntryWritable;

                        // crunch the config object
                        var serialized_config_object = JSON.stringify(configuration);
                        var blob = new Blob([serialized_config_object], {type: 'text/plain'}); // first parameter for Blob needs to be an array

                        chosenFileEntry.createWriter(function (writer) {
                            writer.onerror = function (e) {
                                console.error(e);
                            };

                            var truncated = false;
                            writer.onwriteend = function () {
                                if (!truncated) {
                                    // onwriteend will be fired again when truncation is finished
                                    truncated = true;
                                    writer.truncate(blob.size);

                                    return;
                                }

                                console.log('Write SUCCESSFUL');
                                if (callback) callback();
                            };

                            writer.write(blob);
                        }, function (e) {
                            console.error(e);
                        });
                    } else {
                        // Something went wrong or file is set to read only and cannot be changed
                        console.log('File appears to be read only, sorry.');
                    }
                });
            });
        });
    }
}

function configuration_restore(callback) {
    var chosenFileEntry = null;

    var accepts = [{
        extensions: ['txt']
    }];

    // load up the file
    chrome.fileSystem.chooseEntry({type: 'openFile', accepts: accepts}, function (fileEntry) {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            return;
        }

        if (!fileEntry) {
            console.log('No file selected, restore aborted.');
            return;
        }

        chosenFileEntry = fileEntry;

        // echo/console log path specified
        chrome.fileSystem.getDisplayPath(chosenFileEntry, function (path) {
            console.log('Restore file path: ' + path);
        });

        // read contents into variable
        chosenFileEntry.file(function (file) {
            var reader = new FileReader();

            reader.onprogress = function (e) {
                if (e.total > 1048576) { // 1 MB
                    // dont allow reading files bigger then 1 MB
                    console.log('File limit (1 MB) exceeded, aborting');
                    reader.abort();
                }
            };

            reader.onloadend = function (e) {
                if (e.total != 0 && e.total == e.loaded) {
                    console.log('Read SUCCESSFUL');

                    try { // check if string provided is a valid JSON
                        var configuration = JSON.parse(e.target.result);
                    } catch (e) {
                        // data provided != valid json object
                        console.log('Data provided != valid JSON string, restore aborted.');

                        return;
                    }

                    // validate
                    if (typeof configuration.generatedBy !== 'undefined' && compareVersions(configuration.generatedBy, CONFIGURATOR.backupFileMinVersionAccepted)) {
                                                
                        if (!migrate(configuration)) {
                            GUI.log(chrome.i18n.getMessage('backupFileUnmigratable'));
                            return;
                        }
                        
                        configuration_upload(configuration, callback);
                        
                    } else {
                        GUI.log(chrome.i18n.getMessage('backupFileIncompatible'));
                    }

                    
                }
            };

            reader.readAsText(file);
        });
    });

    function compareVersions(generated, required) {
        if (generated == undefined) {
            return false;
        }
        return semver.gte(generated, required);
    }

    function migrate(configuration) {
        var appliedMigrationsCount = 0;
        var migratedVersion = configuration.generatedBy;
        GUI.log(chrome.i18n.getMessage('configMigrationFrom', [migratedVersion]));
        
        if (!compareVersions(migratedVersion, '0.59.1')) {
            
            // variable was renamed
            configuration.MISC.rssi_channel = configuration.MISC.rssi_aux_channel;
            configuration.MISC.rssi_aux_channel = undefined;
            
            migratedVersion = '0.59.1';
            GUI.log(chrome.i18n.getMessage('configMigratedTo', [migratedVersion]));
            appliedMigrationsCount++;
        }
        
        if (!compareVersions(migratedVersion, '0.60.1')) {
            
            // LED_STRIP support was added.
            if (!configuration.LED_STRIP) {
                configuration.LED_STRIP = [];
            }
            
            migratedVersion = '0.60.1';
            GUI.log(chrome.i18n.getMessage('configMigratedTo', [migratedVersion]));
            appliedMigrationsCount++;
        }
        
        if (!compareVersions(migratedVersion, '0.61.0')) {
            
            // Changing PID controller via UI was added.
            if (!configuration.PIDs && configuration.PID) {
                configuration.PIDs = configuration.PID;
                configuration.PID = {
                    controller: 0 // assume pid controller 0 was used.
                };
            }
            
            migratedVersion = '0.61.0';
            GUI.log(chrome.i18n.getMessage('configMigratedTo', [migratedVersion]));
            appliedMigrationsCount++;
        }

        if (!compareVersions(migratedVersion, '0.63.0')) {
            
            // LED Strip was saved as object instead of array.
            if (typeof(configuration.LED_STRIP) == 'object') {
                var fixed_led_strip = [];

                var index = 0;
                while (configuration.LED_STRIP[index]) {
                    fixed_led_strip.push(configuration.LED_STRIP[index++]);
                }
                configuration.LED_STRIP = fixed_led_strip;
            }

            
            for (var profileIndex = 0; profileIndex < 3; profileIndex++) {
                var RC = configuration.profiles[profileIndex].RC;
                // TPA breakpoint was added
                if (!RC.dynamic_THR_breakpoint) {
                    RC.dynamic_THR_breakpoint = 1500; // firmware default
                }
                
                // Roll and pitch rates were split
                RC.roll_rate = RC.roll_pitch_rate;
                RC.pitch_rate = RC.roll_pitch_rate;
            }
            
            migratedVersion = '0.63.0';
            GUI.log(chrome.i18n.getMessage('configMigratedTo', [migratedVersion]));
            appliedMigrationsCount++;
        }

        if (configuration.apiVersion == undefined) {
            configuration.apiVersion = "1.0.0" // a guess that will satisfy the rest of the code
        }
        // apiVersion previously stored without patchlevel
        if (!semver.parse(configuration.apiVersion)) {
            configuration.apiVersion += ".0";
            if (!semver.parse(configuration.apiVersion)) {
                return false;
            }
        }
        if (compareVersions(migratedVersion, '0.63.0') && !compareVersions(configuration.apiVersion, '1.7.0')) {
            // Serial configuation redesigned, 0.63.0 saves old and new configurations.
            var ports = [];
            for (var portIndex = 0; portIndex < configuration.SERIAL_CONFIG.ports.length; portIndex++) {
                var oldPort = configuration.SERIAL_CONFIG.ports[portIndex];

                var newPort = {
                    identifier: oldPort.identifier,
                    functions: [],
                    msp_baudrate: String(configuration.SERIAL_CONFIG.mspBaudRate),
                    gps_baudrate: String(configuration.SERIAL_CONFIG.gpsBaudRate),
                    telemetry_baudrate: 'AUTO',
                    blackbox_baudrate: '115200',
                };
                
                switch(oldPort.scenario) {
                    case 1: // MSP, CLI, TELEMETRY, SMARTPORT TELEMETRY, GPS-PASSTHROUGH
                    case 5: // MSP, CLI, GPS-PASSTHROUGH
                    case 8: // MSP ONLY
                        newPort.functions.push('MSP');
                    break;
                    case 2: // GPS 
                        newPort.functions.push('GPS');
                    break;
                    case 3: // RX_SERIAL 
                        newPort.functions.push('RX_SERIAL');
                    break;
                    case 10: // BLACKBOX ONLY
                        newPort.functions.push('BLACKBOX');
                    break;
                    case 11: // MSP, CLI, BLACKBOX, GPS-PASSTHROUGH
                        newPort.functions.push('MSP');
                        newPort.functions.push('BLACKBOX');
                    break;
                }
                
                ports.push(newPort);
            }
            configuration.SERIAL_CONFIG = { 
                ports: ports 
            };
            
            appliedMigrationsCount++;
        }
        
        if (compareVersions(migratedVersion, '0.63.0') && !compareVersions(configuration.apiVersion, '1.8.0')) {
            // api 1.8 exposes looptime and arming config
            
            if (configuration.FC_CONFIG == undefined) {
                configuration.FC_CONFIG = {
                    loopTime: 3500
                };
            }

            if (configuration.ARMING_CONFIG == undefined) {
                configuration.ARMING_CONFIG = {
                    auto_disarm_delay:      5,
                    disarm_kill_switch:     1
                };
            }
            appliedMigrationsCount++;
        }
        
        if (compareVersions(migratedVersion, '0.63.0')) {
            // backups created with 0.63.0 for firmwares with api < 1.8 were saved with incorrect looptime
            if (configuration.FC_CONFIG.loopTime == 0) {
                //reset it to the default
                configuration.FC_CONFIG.loopTime = 3500;
            }
        }
        
        if (appliedMigrationsCount > 0) {
            GUI.log(chrome.i18n.getMessage('configMigrationSuccessful', [appliedMigrationsCount]));
        }
                
        return true;
    }
    
    function configuration_upload(configuration, callback) {
        function upload() {
            var activeProfile = null,
                profilesN = 3;

            var profileSpecificData = [
                MSP_codes.MSP_SET_PID_CONTROLLER,
                MSP_codes.MSP_SET_PID,
                MSP_codes.MSP_SET_RC_TUNING,
                MSP_codes.MSP_SET_ACC_TRIM,
                MSP_codes.MSP_SET_SERVO_CONF,
                MSP_codes.MSP_SET_CHANNEL_FORWARDING
            ];

            MSP.send_message(MSP_codes.MSP_STATUS, false, false, function () {
                activeProfile = CONFIG.profile;
                select_profile();
            });

            function select_profile() {
                if (activeProfile > 0) {
                    MSP.send_message(MSP_codes.MSP_SELECT_SETTING, [0], false, upload_specific_data);
                } else {
                    upload_specific_data();
                }
            }

            function upload_specific_data() {
                var savingProfile = 0,
                    codeKey = 0;

                function load_objects(profile) {
                    PID = configuration.profiles[profile].PID;
                    PIDs = configuration.profiles[profile].PIDs;
                    RC_tuning = configuration.profiles[profile].RC;
                    CONFIG.accelerometerTrims = configuration.profiles[profile].AccTrim;
                    SERVO_CONFIG = configuration.profiles[profile].ServoConfig;
                    MODE_RANGES = configuration.profiles[profile].ModeRanges;
                    ADJUSTMENT_RANGES = configuration.profiles[profile].AdjustmentRanges;
                }

                function upload_using_specific_commands() {
                    MSP.send_message(profileSpecificData[codeKey], MSP.crunch(profileSpecificData[codeKey]), false, function () {
                        codeKey++;

                        if (codeKey < profileSpecificData.length) {
                            upload_using_specific_commands();
                        } else {
                            codeKey = 0;
                            savingProfile++;

                            if (savingProfile < profilesN) {
                                load_objects(savingProfile);

                                MSP.send_message(MSP_codes.MSP_EEPROM_WRITE, false, false, function () {
                                    MSP.send_message(MSP_codes.MSP_SELECT_SETTING, [savingProfile], false, upload_using_specific_commands);
                                });
                            } else {
                                MSP.send_message(MSP_codes.MSP_EEPROM_WRITE, false, false, function () {
                                    MSP.send_message(MSP_codes.MSP_SELECT_SETTING, [activeProfile], false, upload_unique_data);
                                });
                            }
                        }
                    });
                }

                function upload_mode_ranges() {
                    MSP.sendModeRanges(upload_adjustment_ranges);
                }
                
                function upload_adjustment_ranges() {
                    MSP.sendAdjustmentRanges(upload_using_specific_commands);
                }
                // start uploading
                load_objects(0);
                upload_mode_ranges();
            }

            function upload_unique_data() {
                var codeKey = 0;

                var uniqueData = [
                    MSP_codes.MSP_SET_MISC,
                    MSP_codes.MSP_SET_RX_MAP,
                    MSP_codes.MSP_SET_BF_CONFIG,
                    MSP_codes.MSP_SET_CF_SERIAL_CONFIG
                ];
                
                function update_unique_data_list() {
                    if (semver.gte(CONFIG.apiVersion, "1.8.0")) {
                        uniqueData.push(MSP_codes.MSP_SET_LOOP_TIME);
                        uniqueData.push(MSP_codes.MSP_SET_ARMING_CONFIG);
                    }
                }
                
                function load_objects() {
                    MISC = configuration.MISC;
                    RC_MAP = configuration.RCMAP;
                    BF_CONFIG = configuration.BF_CONFIG;
                    SERIAL_CONFIG = configuration.SERIAL_CONFIG;
                    LED_STRIP = configuration.LED_STRIP;
                    ARMING_CONFIG = configuration.ARMING_CONFIG;
                    FC_CONFIG = configuration.FC_CONFIG;
                }

                function send_unique_data_item() {
                    if (codeKey < uniqueData.length) {
                        MSP.send_message(uniqueData[codeKey], MSP.crunch(uniqueData[codeKey]), false, function () {
                            codeKey++;
                            send_unique_data_item();
                        });
                    } else {
                        MSP.send_message(MSP_codes.MSP_EEPROM_WRITE, false, false, send_led_strip_config);
                    }
                }

                load_objects();

                update_unique_data_list();

                // start uploading
                send_unique_data_item();
            }

            function send_led_strip_config() {
                MSP.sendLedStripConfig(reboot);
            }
            
            function reboot() {
                GUI.log(chrome.i18n.getMessage('eeprom_saved_ok'));

                GUI.tab_switch_cleanup(function() {
                    MSP.send_message(MSP_codes.MSP_SET_REBOOT, false, false, reinitialize);
                });
            }

            function reinitialize() {
                GUI.log(chrome.i18n.getMessage('deviceRebooting'));

                GUI.timeout_add('waiting_for_bootup', function waiting_for_bootup() {
                    MSP.send_message(MSP_codes.MSP_IDENT, false, false, function () {
                        GUI.log(chrome.i18n.getMessage('deviceReady'));

                        if (callback) callback();
                    });
                }, 1500); // 1500 ms seems to be just the right amount of delay to prevent data request timeouts
            }
        }

        upload();
    }
}