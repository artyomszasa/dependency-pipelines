export default {
    neitherNullNorUndefined (x : any, name : String) : void {
        if (null === x) {
            throw new TypeError(`${name} must not be null!`);
        } else if (undefined === x) {
            throw new TypeError(`${name} must not be undefined!`);
        }
    }
};