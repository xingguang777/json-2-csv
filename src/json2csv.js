'use strict';

let constants = require('./constants.json'),
    utils = require('./utils'),
    _ = require('underscore'),
    path = require('doc-path'),
    deeks = require('deeks');

const Json2Csv = function(options) {
    const wrapDelimiterCheckRegex = new RegExp(options.delimiter.wrap, 'g'),
        crlfSearchRegex = /\r?\n|\r/;

    /** HEADER FIELD FUNCTIONS **/

    /**
     * Returns the list of data field names of all documents in the provided list
     * @param data {Array<Object>} Data to be converted
     * @returns {Promise.<Array[String]>}
     */
    function getFieldNameList(data) {
        // If keys weren't specified,
        return Promise.resolve(deeks.deepKeysFromList(data));
    }

    /**
     * Processes the schemas by checking for schema differences, if so desired.
     * If schema differences are not to be checked, then it resolves the unique
     * list of field names.
     * @param documentSchemas
     * @returns {Promise.<Array[String]>}
     */
    function processSchemas(documentSchemas) {
        // If the user wants to check for the same schema (regardless of schema ordering)
        if (options.checkSchemaDifferences) {
            return checkSchemaDifferences(documentSchemas);
        } else {
            // Otherwise, we do not care if the schemas are different, so we should get the unique list of keys
            let uniqueFieldNames = _.uniq(_.flatten(documentSchemas));
            return Promise.resolve(uniqueFieldNames);
        }
    }

    /**
     * This function performs the schema difference check, if the user specifies that it should be checked.
     * If there are no field names, then there are no differences.
     * Otherwise, we get the first schema and the remaining list of schemas
     * @param documentSchemas
     * @returns {*}
     */
    function checkSchemaDifferences(documentSchemas) {
        // have multiple documents - ensure only one schema (regardless of field ordering)
        let firstDocSchema = documentSchemas[0],
            restOfDocumentSchemas = documentSchemas.slice(1),
            schemaDifferences = computeNumberOfSchemaDifferences(firstDocSchema, restOfDocumentSchemas);

        // If there are schema inconsistencies, throw a schema not the same error
        if (schemaDifferences) {
            return Promise.reject(new Error(constants.errors.json2csv.notSameSchema));
        }

        return Promise.resolve(firstDocSchema);
    }

    /**
     * Computes the number of schema differences
     * @param firstDocSchema
     * @param restOfDocumentSchemas
     * @returns {*}
     */
    function computeNumberOfSchemaDifferences(firstDocSchema, restOfDocumentSchemas) {
        return restOfDocumentSchemas.reduce((schemaDifferences, documentSchema) => {
            // If there is a difference between the schemas, increment the counter of schema inconsistencies
            let numberOfDifferences = utils.computeSchemaDifferences(firstDocSchema, documentSchema).length;
            return numberOfDifferences > 0
                ? schemaDifferences + 1
                : schemaDifferences;
        }, 0);
    }

    /**
     * If so specified, this sorts the header field names alphabetically
     * @param fieldNames {Array<String>}
     * @returns {Array<String>} sorted field names, or unsorted if sorting not specified
     */
    function sortHeaderFields(fieldNames) {
        if (options.sortHeader) {
            return fieldNames.sort();
        }
        return fieldNames;
    }

    /**
     * Trims the header fields, if the user desires them to be trimmed.
     * @param params
     * @returns {*}
     */
    function trimHeaderFields(params) {
        if (options.trimHeaderFields) {
            params.headerFields = params.headerFields.map((field) => field.split('.')
                .map((component) => component.trim())
                .join('.')
            );
        }
        return params;
    }

    /**
     * Wrap the headings, if desired by the user.
     * @param params
     * @returns {*}
     */
    function wrapHeaderFields(params) {
        // only perform this if we are actually prepending the header
        if (options.prependHeader) {
            params.headerFields = params.headerFields.map(function(headingKey) {
                return wrapFieldValueIfNecessary(headingKey);
            });
        }
        return params;
    }

    /**
     * Generates the CSV header string by joining the headerFields by the field delimiter
     * @param params
     * @returns {*}
     */
    function generateCsvHeader(params) {
        params.header = params.headerFields.join(options.delimiter.field);
        return params;
    }

    /**
     * Retrieve the headings for all documents and return it.
     * This checks that all documents have the same schema.
     * @param data
     * @returns {Promise}
     */
    function retrieveHeaderFields(data) {
        if (options.keys) {
            return Promise.resolve(options.keys)
                .then(sortHeaderFields);
        }

        return getFieldNameList(data)
            .then(processSchemas)
            .then(sortHeaderFields);
    }

    /** RECORD FIELD FUNCTIONS **/

    /**
     * Main function which handles the processing of a record, or document to be converted to CSV format
     * This function specifies and performs the necessary operations in the necessary order
     * in order to obtain the data and convert it to CSV form while maintaining RFC 4180 compliance.
     * * Order of operations:
     * - Get fields from provided key list (as array of actual values)
     * - Convert the values to csv/string representation [possible option here for custom converters?]
     * - Trim fields
     * - Determine if they need to be wrapped (& wrap if necessary)
     * - Combine values for each line (by joining by field delimiter)
     * @param params
     * @returns {*}
     */
    function processRecords(params) {
        params.records = params.records.map((record) => {
            // Retrieve data for each of the headerFields from this record
            let recordFieldData = retrieveRecordFieldData(record, params.headerFields),

                // Process the data in this record and return the
                processedRecordData = recordFieldData.map((fieldValue) => {
                    fieldValue = trimRecordFieldValue(fieldValue);
                    fieldValue = recordFieldValueToString(fieldValue);
                    fieldValue = wrapFieldValueIfNecessary(fieldValue);

                    return fieldValue;
                });

            // Join the record data by the field delimiter
            return generateCsvRowFromRecord(processedRecordData);
        }).join(options.delimiter.eol);

        return params;
    }

    /**
     * Gets all field values from a particular record for the given list of fields
     * @param record
     * @param fields
     * @returns {Array}
     */
    function retrieveRecordFieldData(record, fields) {
        let recordValues = [];

        fields.forEach((field) => {
            let recordFieldValue = path.evaluatePath(record, field);

            if (!_.isUndefined(options.emptyFieldValue) && utils.isEmptyField(recordFieldValue)) {
                recordFieldValue = options.emptyFieldValue;
            }

            recordValues.push(recordFieldValue);
        });

        return recordValues;
    }

    /**
     * Converts a record field value to its string representation
     * @param fieldValue
     * @returns {*}
     */
    function recordFieldValueToString(fieldValue) {
        if (_.isArray(fieldValue) || _.isObject(fieldValue)) {
            return JSON.stringify(fieldValue);
        } else if (_.isUndefined(fieldValue)) {
            return 'undefined';
        } else if (_.isNull(fieldValue)) {
            return 'null';
        } else {
            return fieldValue.toString();
        }
    }

    /**
     * Trims the record field value, if specified by the user's provided options
     * @param fieldValue
     * @returns {*}
     */
    function trimRecordFieldValue(fieldValue) {
        if (options.trimFieldValues) {
            if (_.isArray(fieldValue)) {
                return fieldValue.map(trimRecordFieldValue);
            } else if (_.isString(fieldValue)) {
                return fieldValue.trim();
            }
            return fieldValue;
        }
        return fieldValue;
    }

    /**
     * Escapes quotation marks in the field value, if necessary, and appropriately
     * wraps the record field value if it contains a comma (field delimiter),
     * quotation mark (wrap delimiter), or a line break (CRLF)
     * @param fieldValue
     * @returns {*}
     */
    function wrapFieldValueIfNecessary(fieldValue) {
        const wrapDelimiter = options.delimiter.wrap;

        // eg. includes quotation marks (default delimiter)
        if (fieldValue.includes(options.delimiter.wrap)) {
            // add an additional quotation mark before each quotation mark appearing in the field value
            fieldValue = fieldValue.replace(wrapDelimiterCheckRegex, wrapDelimiter + wrapDelimiter);
        }
        // if the field contains a comma (field delimiter), quotation mark (wrap delimiter), line break, or CRLF
        //   then enclose it in quotation marks (wrap delimiter)
        if (fieldValue.includes(options.delimiter.field) ||
            fieldValue.includes(options.delimiter.wrap) ||
            fieldValue.match(crlfSearchRegex)) {
            // wrap the field's value in a wrap delimiter (quotation marks by default)
            fieldValue = wrapDelimiter + fieldValue + wrapDelimiter;
        }

        return fieldValue;
    }

    /**
     * Generates the CSV record string by joining the field values together by the field delimiter
     * @param recordFieldValues
     */
    function generateCsvRowFromRecord(recordFieldValues) {
        return recordFieldValues.join(options.delimiter.field);
    }

    /** CSV COMPONENT COMBINER/FINAL PROCESSOR **/
    /**
     * Performs the final CSV construction by combining the fields in the appropriate
     * order depending on the provided options values and sends the generated CSV
     * back to the user
     * @param params
     */
    function generateCsvFromComponents(params) {
        let header = params.header,
            records = params.records,

            // If we are prepending the header, then add an EOL, otherwise just return the records
            csv = (options.excelBOM ? constants.values.excelBOM : '') +
                (options.prependHeader ? header + options.delimiter.eol : '') +
                records;

        return params.callback(null, csv);
    }

    /** MAIN CONVERTER FUNCTION **/

    /**
     * Internally exported json2csv function
     * Takes data as either a document or array of documents and a callback that will be used to report the results
     * @param data {Object|Array<Object>} documents to be converted to csv
     * @param callback {Function} callback function
     */
    function convert(data, callback) {
        // Single document, not an array
        if (_.isObject(data) && !data.length) {
            data = [data]; // Convert to an array of the given document
        }

        // Retrieve the heading and then generate the CSV with the keys that are identified
        retrieveHeaderFields(data)
            .then((headerFields) => ({
                headerFields,
                callback,
                records: data
            }))
            .then(processRecords)
            .then(wrapHeaderFields)
            .then(trimHeaderFields)
            .then(generateCsvHeader)
            .then(generateCsvFromComponents)
            .catch(callback);
    }

    return {
        convert,
        validationFn: _.isObject,
        validationMessages: constants.errors.json2csv
    };
};

module.exports = { Json2Csv };
