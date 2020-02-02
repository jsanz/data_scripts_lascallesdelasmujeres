'use strict';

const path = require('path');
const fs = require('fs');

const overpass = require('query-overpass');

const booleanContains = require('@turf/boolean-contains').default;
const flatten = require('@turf/flatten').default;

const parse = require('csv-parse/lib/sync');

const args = require('yargs')
                .usage('Pass a city name to get the step 1 data and an OSM relation ID to clip it!')
                .epilog('GeoChicas OSM 2019')
                .alias('h','help')
                .alias('c','city')
                .alias('r','relation')
                .describe('c','City in your data folder')
                .describe('r','OSM relation ID for that city')
                .demandOption(['c','r'])
                .argv;

// Returns the city features using the project convention file naming
function getFeatures(city){
    const geojsonFilePath = path.join(process.cwd(),'data',city, city + '_streets.geojson');
    console.log('Reading ', geojsonFilePath);

    const originalGeojson = fs.readFileSync(geojsonFilePath);

    const originalData = JSON.parse(originalGeojson);
    if (!originalData || ! 'features' in originalData){
        throw new Error('File does not look as a GeoJSON')
    }
    return originalData.features;
}

// Returns a promise with the relation feature
async function getBoundary(id){
    return new Promise((resolve, reject) => {
        const query = `relation(${id});(._;>;);out;`;
        console.log('Requestind data to the Overpass API...')
        console.log('query: ', query);

        overpass(query, (error, data) => {
            if (error){
                console.log('Something happened', error);
                reject(error);
            }
            const relationFeatures = data.features.filter(el => el.properties.type == 'relation' );

            if (relationFeatures.length == 0){
                reject(new Error('No features on this relation'));
            }

            resolve(relationFeatures[0]);
        })
    });
}

// Writes a GeoJSON into the passed file path
function writeFeatures(outputPath, features){
    const jsonString = JSON.stringify({
        type: "FeatureCollection",
        features: features
    });

    fs.writeFileSync(outputPath, jsonString);
}

// main function
async function processCity(city, relationId){
    const basePath = path.join(process.cwd(),'data',city);
    // Get the original (square) geojson data
    const features = getFeatures(city);
    console.log(`${features.length} features on you GeoJSON file`);

    // Get the OSM relation and flatten it to generate different geometries
    const cityBoundaries = flatten(await getBoundary(relationId)).features;

    const cityFilePath = path.join(basePath, city + '_boundary.geojson');
    writeFeatures(cityFilePath, cityBoundaries);
    console.log('City boundary: ', cityFilePath);

    // Find if a feature intersects with any of the city boundaries
    const filteredFeatures = features.filter(feature => {
            return cityBoundaries.find(boundary => {
                return booleanContains(boundary, feature);
            });
    });

    console.log('Filtered features: ', filteredFeatures.length);
    
    const filteredFeaturesPath = path.join(basePath, city + '_streets_filtered.geojson');
    console.log('Writing the result at: ', filteredFeaturesPath)
    
    writeFeatures(filteredFeaturesPath, filteredFeatures);

    // Generate a filtered list.csv
    const streetsStr = fs.readFileSync(path.join(basePath, 'list.csv')).toString();
    console.log(streetsStr.slice(0,100));
    const streetsCsv = parse(streetsStr, {delimiter: ';'});

    console.log(streetsCsv[0]);
    process.exit(0);

    const newStreet =  filteredFeatures
                        .map( f => {
                            const id = f.properties.id;
                            return streetsCsv
                                    .filter( s => s[2] == id)
                                    .map( s => s.join(';'))
                        })
                        .filter(f => f.length != 0);
    fs.writeFileSync(
        path.join(basePath, 'list_filtered.csv'),
        newStreet.join('\n'));
}


try {
    console.log('city       : ',args.c);
    console.log('relation id: ', args.r);

    processCity(args.c, args.r)
        .then(()=>{
            console.log('Done!!')
            process.exit(0);
    });

} catch (error) {
    console.log('Something went wrong:', error.message);
    process.exit(1)
}