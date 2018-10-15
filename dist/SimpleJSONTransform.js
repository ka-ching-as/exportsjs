"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const numeral_1 = __importDefault(require("numeral"));
class SimpleJSONTransform {
    constructor(configuration, data) {
        this.data = data;
        this.configuration = configuration;
    }
    export() {
        const body = {};
        for (const key in this.configuration) {
            const expression = this.configuration[key];
            const value = this.parametrizeString(expression, this.data);
            if (value !== "#SKIP_THIS#") {
                body[key] = value;
            }
        }
        return body;
    }
    valueFromPath(path, obj) {
        return path.split('.').reduce((o, i) => { if (o) {
            return o[i];
        }
        else {
            return "undefined";
        } }, obj);
    }
    parametrizeString(string, object) {
        return string.replace(/({.*?})/g, j => {
            var removedBraces = j.substr(1).slice(0, -1);
            var components = removedBraces.split('|');
            var path = components[0];
            var value = this.valueFromPath(path, object);
            if (value.constructor === Number) {
                return numeral_1.default(value).format();
            }
            else {
                return value;
            }
        });
    }
}
exports.SimpleJSONTransform = SimpleJSONTransform;
