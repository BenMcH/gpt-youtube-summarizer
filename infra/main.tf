terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "4.67.0"
    }
  }

  backend "s3" {
    bucket = "mchonedev-terraform-state"
    key    = "gpt-summarizer/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project = "GPT Summarizer"
    }
  }
}

resource "aws_s3_bucket" "artifact_bucket" {
  bucket = "mchonedev-gpt-summarizer"
}

