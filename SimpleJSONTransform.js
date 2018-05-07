const numeral = require('numeral');

class SimpleJSONTransform {
    constructor(configuration, data) {
        this.data = data;
        this.configuration = configuration;
    }

    export() {
        var body = {};
        for (var key in this.configuration) {
            const expression = this.configuration[key];
            const value = this.parametrizeString(expression, this.data);
            if (value !== "#SKIP_THIS#") {
                body[key] = value;
            }
        }
        return body;
    }

    valueFromPath(path, obj) {
        return path.split('.').reduce((o, i) => { if (o) { return o[i]; } else { return "undefined"; } }, obj)
    }

    parametrizeString(string, object) {
        return string.replace(/({.*?})/g, j => {
            var removedBraces = j.substr(1).slice(0, -1);
            var components = removedBraces.split('|');
            var path = components[0];
            var value = this.valueFromPath(path, object);
            if (components.length > 1) {
                var reportInterval = components[1];
                // var oldTotal = oldValue.total || 0;
                // var newTotal = result.snapshot.val().total;
                // console.log("OLD: " + oldTotal);
                // console.log("NEW: " + newTotal);
                // var reportInterval = 10000;
                // if (parseInt(oldTotal / reportInterval) != parseInt(newTotal / reportInterval)) {
                //   console.log("We now passed the " + (parseInt(newTotal / reportInterval) * reportInterval) + " mark for the current " + period);
                // }

                var oldValue = this.valueFromPath(path, object.previous) || 0;
                if (parseInt(oldValue / reportInterval, 10) !== parseInt(value / reportInterval, 10)) {
                    var boundary = (parseInt(value / reportInterval, 10) * reportInterval);
                    return numeral(boundary).format();
                } else {
                    return "#SKIP_THIS#";
                }
            }
            if (value.constructor === Number) {
                return numeral(value).format();
            } else {
                return value;
            }
        });
    }
}

module.exports = SimpleJSONTransform;
