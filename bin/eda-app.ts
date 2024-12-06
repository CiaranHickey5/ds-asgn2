#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { Asgn2Stack } from "../lib/asgn2-stack";

const app = new cdk.App();
new Asgn2Stack(app, "Asgn2Stack", {
  env: { region: "eu-west-1" },
});
